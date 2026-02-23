// copied from https://github.com/ueokande/playwright-webextext

"use strict";
// This is TypeScript version of the following
// https://github.com/mozilla/web-ext/blob/master/src/firefox/rdp-client.js

Object.defineProperty(exports, "__esModule", { value: true });
exports.connectToFirefox = exports.parseRDPMessage = exports.DEFAULT_HOST = exports.DEFAULT_PORT = void 0;

const tslib_1 = require("tslib");
const net = tslib_1.__importStar(require("node:net"));
const events_1 = require("events");
const domain = tslib_1.__importStar(require("domain"));

exports.DEFAULT_PORT = 6000;
exports.DEFAULT_HOST = "127.0.0.1";
const UNSOLICITED_EVENTS = new Set([
    "tabNavigated",
    "styleApplied",
    "propertyChange",
    "networkEventUpdate",
    "networkEvent",
    "propertyChange",
    "newMutations",
    "frameUpdate",
    "tabListChanged",
]);

// Parse RDP packets: BYTE_LENGTH + ':' + DATA.
function parseRDPMessage(data) {
    const str = data.toString();
    const sepIdx = str.indexOf(":");
    if (sepIdx < 1) {
        return { data };
    }
    const byteLen = parseInt(str.slice(0, sepIdx));
    if (isNaN(byteLen)) {
        const error = new Error("Error parsing RDP message length");
        return { data, error, fatal: true };
    }
    if (data.length - (sepIdx + 1) < byteLen) {
        // Can't parse yet, will retry once more data has been received.
        return { data };
    }
    data = data.slice(sepIdx + 1);
    const msg = data.slice(0, byteLen);
    data = data.slice(byteLen);
    try {
        return { data, rdpMessage: JSON.parse(msg.toString()) };
    }
    catch (error) {
        return { data, error: error, fatal: false };
    }
}
exports.parseRDPMessage = parseRDPMessage;

function connectToFirefox(port) {
    const client = new FirefoxRDPClient();
    return client.connect(port).then(() => client);
}
exports.connectToFirefox = connectToFirefox;

class FirefoxRDPClient extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.incoming = Buffer.alloc(0);
        this.pending = [];
        this.active = new Map();
        this._onData = (data) => this.onData(data);
        this._onError = (err) => this.onError(err);
        this._onEnd = () => this.onEnd();
        this._onTimeout = () => this.onTimeout();
    }
    connect(port) {
        return new Promise((resolve, reject) => {
            // Create a domain to wrap the errors that may be triggered
            // by creating the client connection (e.g. ECONNREFUSED)
            // so that we can reject the promise returned instead of
            // exiting the entire process.
            const d = domain.create();
            d.once("error", reject);
            d.run(() => {
                const conn = net.createConnection({
                    port,
                    host: exports.DEFAULT_HOST,
                });
                this.rdpConnection = conn;
                conn.on("data", this._onData);
                conn.on("error", this._onError);
                conn.on("end", this._onEnd);
                conn.on("timeout", this._onTimeout);
                // Resolve once the expected initial root message
                // has been received.
                this.expectReply("root", { resolve, reject });
            });
        });
    }
    disconnect() {
        if (!this.rdpConnection) {
            return;
        }
        const conn = this.rdpConnection;
        conn.off("data", this._onData);
        conn.off("error", this._onError);
        conn.off("end", this._onEnd);
        conn.off("timeout", this._onTimeout);
        conn.end();
        this.rejectAllRequests(new Error("RDP connection closed"));
    }
    rejectAllRequests(error) {
        for (const activeDeferred of Array.from(this.active.values())) {
            activeDeferred.reject(error);
        }
        this.active.clear();
        for (const { deferred } of this.pending) {
            deferred.reject(error);
        }
        this.pending = [];
    }
    async request(requestProps) {
        let request;
        if (typeof requestProps === "string") {
            request = { to: "root", type: requestProps };
        }
        else {
            request = requestProps;
        }
        if (request.to == null) {
            throw new Error(`Unexpected RDP request without target actor: ${request.type}`);
        }
        return new Promise((resolve, reject) => {
            const deferred = { resolve, reject };
            this.pending.push({ request, deferred });
            this.flushPendingRequests();
        });
    }
    flushPendingRequests() {
        this.pending = this.pending.filter(({ request, deferred }) => {
            if (this.active.has(request.to)) {
                // Keep in the pending requests until there are no requests
                // active on the target RDP actor.
                return true;
            }
            const conn = this.rdpConnection;
            if (!conn) {
                throw new Error("RDP connection closed");
            }
            try {
                let str = JSON.stringify(request);
                str = `${Buffer.from(str).length}:${str}`;
                conn.write(str);
                this.expectReply(request.to, deferred);
            }
            catch (err) {
                deferred.reject(err);
            }
            // Remove the pending request from the queue.
            return false;
        });
    }
    expectReply(targetActor, deferred) {
        if (this.active.has(targetActor)) {
            throw new Error(`${targetActor} does already have an active request`);
        }
        this.active.set(targetActor, deferred);
    }
    handleMessage(rdpData) {
        if (rdpData.from == null) {
            if (rdpData.error) {
                this.emit("rdp-error", rdpData);
                return;
            }
            this.emit("error", new Error(`Received an RDP message without a sender actor: ${JSON.stringify(rdpData)}`));
            return;
        }
        if (UNSOLICITED_EVENTS.has(rdpData.type)) {
            this.emit("unsolicited-event", rdpData);
            return;
        }
        if (this.active.has(rdpData.from)) {
            const deferred = this.active.get(rdpData.from);
            this.active.delete(rdpData.from);
            if (rdpData.error) {
                deferred?.reject(rdpData);
            }
            else {
                deferred?.resolve(rdpData);
            }
            this.flushPendingRequests();
            return;
        }
        this.emit("error", new Error(`Unexpected RDP message received: ${JSON.stringify(rdpData)}`));
    }
    readMessage() {
        const { data, rdpMessage, error, fatal } = parseRDPMessage(this.incoming);
        this.incoming = data;
        if (error) {
            this.emit("error", new Error(`Error parsing RDP packet: ${String(error)}`));
            // Disconnect automatically on a fatal error.
            if (fatal) {
                this.disconnect();
            }
            // Caller can parse the next message if the error wasn't fatal
            // (e.g. the RDP packet that couldn't be parsed has been already
            // removed from the incoming data buffer).
            return !fatal;
        }
        if (!rdpMessage) {
            // Caller will need to wait more data to parse the next message.
            return false;
        }
        this.handleMessage(rdpMessage);
        // Caller can try to parse the next message from the remining data.
        return true;
    }
    onData(data) {
        this.incoming = Buffer.concat([this.incoming, data]);
        while (this.readMessage()) {
            // Keep parsing and handling messages until readMessage
            // returns false.
        }
    }
    onError(error) {
        this.emit("error", error);
    }
    onEnd() {
        this.emit("end");
    }
    onTimeout() {
        this.emit("timeout");
    }
}
exports.default = FirefoxRDPClient;
