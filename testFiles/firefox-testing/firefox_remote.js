// copied from https://github.com/ueokande/playwright-webextext

"use strict";
// This is TypeScript version of the following
// https://github.com/mozilla/web-ext/blob/7.1.1/src/firefox/remote.js
Object.defineProperty(exports, "__esModule", { value: true });

const tslib_1 = require("tslib");
const net = tslib_1.__importStar(require("node:net"));
const firefox_rdpclient_1 = require("./firefox_rdpclient");

function isErrorWithCode(codeWanted, error) {
    if (Array.isArray(codeWanted) && codeWanted.indexOf(error.code) !== -1) {
        return true;
    }
    else if (error.code === codeWanted) {
        return true;
    }
    return false;
}
exports.isErrorWithCode = isErrorWithCode;

// Convert a request rejection to a message string.
function requestErrorToMessage(err) {
    if (err instanceof Error) {
        return String(err);
    }
    return `${err.error}: ${err.message}`;
}

class RemoteFirefox {
    constructor(client) {
        this.client = client;
        this.checkedForAddonReloading = false;
    }
    disconnect() {
        this.client.disconnect();
    }
    async addonRequest(addon, request) {
        try {
            const response = await this.client.request({
                to: addon.actor,
                type: request,
            });
            return response;
        }
        catch (err) {
            const message = requestErrorToMessage(err);
            throw new Error(`Remote Firefox: addonRequest() error: ${message}`);
        }
    }
    async getAddonsActor() {
        try {
            // getRoot should work since Firefox 55 (bug 1352157).
            const response = await this.client.request("getRoot");
            if (response.addonsActor == null) {
                return Promise.reject(new Error("This version of Firefox does not provide an add-ons actor for " +
                    "remote installation."));
            }
            return response.addonsActor;
        }
        catch (err) {
            // Fallback to listTabs otherwise, Firefox 49 - 77 (bug 1618691).
        }
        try {
            const response = await this.client.request("listTabs");
            // addonsActor was added to listTabs in Firefox 49 (bug 1273183).
            if (response.addonsActor == null) {
                return Promise.reject(new Error("This is an older version of Firefox that does not provide an " +
                    "add-ons actor for remote installation. Try Firefox 49 or " +
                    "higher."));
            }
            return response.addonsActor;
        }
        catch (err) {
            const message = requestErrorToMessage(err);
            throw new Error(`Remote Firefox: listTabs() error: ${message}`);
        }
    }
    async installTemporaryAddon(addonPath) {
        const addonsActor = await this.getAddonsActor();
        try {
            const response = await this.client.request({
                to: addonsActor,
                type: "installTemporaryAddon",
                addonPath,
            });
            return response;
        }
        catch (err) {
            const message = requestErrorToMessage(err);
            throw new Error(`installTemporaryAddon: Error: ${message}`);
        }
    }
    async getInstalledAddon(addonId) {
        try {
            const response = await this.client.request("listAddons");
            for (const addon of response.addons) {
                if (addon.id === addonId) {
                    return addon;
                }
            }
            return Promise.reject(new Error("The remote Firefox does not have your extension installed"));
        }
        catch (err) {
            const message = requestErrorToMessage(err);
            throw new Error(`Remote Firefox: listAddons() error: ${message}`);
        }
    }
    async checkForAddonReloading(addon) {
        if (this.checkedForAddonReloading) {
            // We only need to check once if reload() is supported.
            return addon;
        }
        else {
            const response = await this.addonRequest(addon, "requestTypes");
            if (response.requestTypes.indexOf("reload") === -1) {
                throw new Error("This Firefox version does not support add-on reloading. " +
                    "Re-run with --no-reload");
            }
            else {
                this.checkedForAddonReloading = true;
                return addon;
            }
        }
    }
    async reloadAddon(addonId) {
        const addon = await this.getInstalledAddon(addonId);
        await this.checkForAddonReloading(addon);
        await this.addonRequest(addon, "reload");
    }
}
exports.RemoteFirefox = RemoteFirefox;

async function connect(port, { connectToFirefox = firefox_rdpclient_1.connectToFirefox } = {}) {
    const client = await connectToFirefox(port);
    return new RemoteFirefox(client);
}
exports.connect = connect;

async function connectWithMaxRetries(
// A max of 250 will try connecting for 30 seconds.
{ maxRetries = 250, retryInterval = 120, port }, { connectToFirefox = connect } = {}) {
    async function establishConnection() {
        let lastError;
        for (let retries = 0; retries <= maxRetries; retries++) {
            try {
                return await connectToFirefox(port);
            }
            catch (error) {
                if (isErrorWithCode("ECONNREFUSED", error)) {
                    // Wait for `retryInterval` ms.
                    await new Promise((resolve) => {
                        setTimeout(resolve, retryInterval);
                    });
                    lastError = error;
                }
                else {
                    throw error;
                }
            }
        }
        throw lastError;
    }
    return establishConnection();
}
exports.connectWithMaxRetries = connectWithMaxRetries;
