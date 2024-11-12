const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const udbrowser = require('undetected-browser');

puppeteer.use(StealthPlugin());

const log = (data) => {
    try {
        console.log(`bloxRaper | ${data}`);
    } catch {}
};

class bloxRaper {
    constructor({ debug = false } = {}) {
        this.debug = debug;
        this.namespaces = [
            'chat', 'cups', 'blackjack', 'jackpot', 'rouletteV2', 'roulette',
            'crash', 'wallet', 'marketplace', 'case-battles', 'mod-queue', 'feed', 'cloud-games'
        ];
        this.clients = new Map();
        this.browser = null;
        this.page = null;
        this.session = null;
        this.ready = this.initialize();
    }

    async initialize() {
        try {
            log("launching instance");
            const launchOptions = {
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            };

            if (!this.debug) {
                launchOptions.args.push(
                    '--window-position=99999,99999',
                    '--window-size=1,1',
                    '--disable-extensions',
                    '--disable-gpu',
                    '--mute-audio'
                );
                launchOptions.defaultViewport = { width: 1, height: 1 };
            }

            this.udinstance = new udbrowser(await puppeteer.launch(launchOptions));
            this.browser = await this.udinstance.getBrowser();
            this.page = (await this.browser.pages())[0];
            this.session = await this.page.target().createCDPSession();

            if (!this.debug) {
                const { windowId } = await this.session.send('Browser.getWindowForTarget');
                await this.session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
            }

            log("setting up request interception");
            await this.page.setRequestInterception(true);
            this.page.on('request', (request) => {
                try {
                    const url = request.url();
                    if (["render-headshot", "png", "mp3", "wav", "stripe", "tiktok", "taboola", "onesignal", "css", "intercom", "growthbook"].some(str => url.includes(str))) {
                        request.abort();
                    } else {
                        request.continue();
                    }
                } catch {}
            });

            await this.page.goto('https://bloxflip.com/');

            log("clearing data");
            await this.session.send('Network.clearBrowserCookies');
            await this.page.evaluate(() => {
                try {
                    localStorage.clear();
                    window.bloxflipClients = new Map();
                } catch {}
            });

            log("init");
            return true;
        } catch (e){console.log(e)}
    }

    async connect(auth) {
        try {
            await this.ready;
            const clientId = Date.now().toString();
            await this.page.evaluate((clientId, auth, namespaces) => {
                document.title = "bloxraper instance" // clout
                return new Promise((resolve, reject) => {
                    try {
                        const client = {
                            auth,
                            namespaces,
                            ws: null,
                            isReady: null,
                            eventListeners: {},

                            connect: function() {
                                try {
                                    this.ws = new WebSocket('wss://ws.bloxflip.com/socket.io/?EIO=3&transport=websocket');
                                    this.isReady = new Promise((resolveReady, rejectReady) => {
                                        try {
                                            this.ws.onopen = async () => {
                                                try {
                                                    await Promise.all(this.namespaces.map(namespace => this.ws.send(`40/${namespace},`)));
                                                    setTimeout(async () => {
                                                        try {
                                                            await Promise.all(this.namespaces.map(namespace => this.ws.send(`42/${namespace},["auth","${this.auth}"]`)));
                                                            this.ws.send("2")
                                                            this.isReady = true;
                                                            setInterval(() => {
                                                                try {
                                                                    this.ws.send("2")
                                                                } catch {}
                                                            }, 20000);
                                                            this.ws.timeout = 3000000;
                                                            resolveReady();
                                                        } catch {}
                                                    }, 500);
                                                } catch {}
                                            };
                                            this.ws.onerror = rejectReady;
                                        } catch {}
                                    });
                                    this.ws.onmessage = (event) => {
                                        try {
                                            if (this.eventListeners['message']) {
                                                this.eventListeners['message'].forEach(callback => {
                                                    try {
                                                        callback(event.data)
                                                    } catch {}
                                                });
                                            }
                                        } catch {}
                                    };
                                    this.ws.onclose = () => {
                                        try {
                                            if (this.eventListeners['close']) {
                                                this.eventListeners['close'].forEach(callback => {
                                                    try {
                                                        callback()
                                                    } catch {}
                                                });
                                            }
                                        } catch {}
                                    };
                                } catch {}
                            },

                            emit: async function(namespace, event, data) {
                                try {
                                    await this.isReady;
                                    this.ws.send(`42/${namespace},[${JSON.stringify(event)},${JSON.stringify(data)}]`);
                                } catch {}
                            },

                            send: async function(data) {
                                try {
                                    await this.isReady;
                                    this.ws.send(data);
                                } catch {}
                            },

                            on: function(event, callback) {
                                try {
                                    if (!this.eventListeners[event]) {
                                        this.eventListeners[event] = [];
                                    }
                                    this.eventListeners[event].push(callback);
                                } catch {}
                            },

                            close: function() {
                                try {
                                    if (this.ws) {
                                        this.ws.close();
                                    }
                                } catch {}
                            }
                        };

                        client.connect();
                        window.bloxflipClients.set(clientId, client);

                        client.isReady
                            .then(() => new Promise(resolve => setTimeout(resolve, 1000)))
                            .then(resolve)
                            .catch(reject);
                    } catch {}
                });
            }, clientId, auth, this.namespaces);

            this.clients.set(clientId, {
                emit: this.emit.bind(this, clientId),
                send: this.send.bind(this, clientId),
                on: this.on.bind(this, clientId),
                close: this.closeClient.bind(this, clientId)
            });

            return this.clients.get(clientId);
        } catch {}
    }

    async emit(clientId, namespace, event, data) {
        try {
            return await this.page.evaluate((clientId, namespace, event, data) => {
                try {
                    const client = window.bloxflipClients.get(clientId);
                    return client.emit(namespace, event, data);
                } catch {}
            }, clientId, namespace, event, data);
        } catch {}
    }
    
    async send(clientId, data) {
        try {
            return await this.page.evaluate((clientId, data) => {
                try {
                    const client = window.bloxflipClients.get(clientId);
                    return client.send(data);
                } catch {}
            }, clientId, data);
        } catch {}
    }

    async on(clientId, event, callback) {
        try {
            const callbackName = `raper_${clientId}_${event}${ Math.random().toString(36).substring(2, 5) }`;
            await this.page.exposeFunction(callbackName, callback);
            await this.page.evaluate((clientId, event, callbackName) => {
                try {
                    const client = window.bloxflipClients.get(clientId);
                    client.on(event, (data) => {
                        try {
                            window[callbackName](data);
                        } catch {}
                    });
                } catch {}
            }, clientId, event, callbackName);
        } catch {}
    }

    async closeClient(clientId) {
        try {
            await this.page.evaluate((clientId) => {
                try {
                    const client = window.bloxflipClients.get(clientId);
                    if (client) {
                        client.close();
                        window.bloxflipClients.delete(clientId);
                    }
                } catch {}
            }, clientId);
            this.clients.delete(clientId);
        } catch {}
    }

    async close() {
        try {
            for (const clientId of this.clients.keys()) {
                await this.closeClient(clientId);
            }
            if (this.browser) {
                await this.browser.close();
            }
        } catch {}
    }
    
    parse(thing) {
        try {
            const match = thing.match(/^42\/([^,]+),\[([^,]+),(.*)\]$/);
            if (!match) {
                throw new Error("wtf");
            }
            const [, namespace, event, data] = match;
            return {
                namespace,
                event: JSON.parse(event),
                data: JSON.parse(data)
            };
        } catch {}
    }
}

module.exports = bloxRaper;
