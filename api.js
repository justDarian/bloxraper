const puppeteer = require('puppeteer');

const log = (data) => {
    console.log(`bloxRaper | ${data}`)
}

class BloxflipRaper {
    constructor({ debug = false} = {}) {
        this.debug = debug;
        this.namespaces = [
            'chat', 'cups', 'blackjack', 'jackpot', 'rouletteV2', 'roulette',
            'crash', 'wallet', 'marketplace', 'case-battles', 'mod-queue', 'feed', 'cloud-games'
        ]
        this.clients = new Map()
        this.browser = null
        this.page = null
        this.session = null
        this.ready = this.initialize()
    }

    async initialize() {
        const launchOptions = {
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process']
        };

        if (!this.debug) {
            launchOptions.args.push(
                '--window-position=99999,99999', 
                '--window-size=1,1',
                '--disable-extensions',
                '--disable-gpu',
                '--mute-audio',
                '--disable-background-networking',
                '--disable-default-apps',
                '--no-default-browser-check'
            );
            launchOptions.defaultViewport = { width: 1, height: 1 };
        }

        log('creating an instance...')
        this.browser = await puppeteer.launch(launchOptions)
        this.page = (await this.browser.pages())[0]
        this.session = await this.page.target().createCDPSession()

        if (!this.debug) {
            const {windowId} = await this.session.send('Browser.getWindowForTarget')
            await this.session.send('Browser.setWindowBounds', {windowId, bounds: {windowState: 'minimized'}})
        }

        log("setting up request interception")
        await this.page.setRequestInterception(true);
        this.page.on('request', (request) => {
            const url = request.url()
            if (["api.bloxflip.com", "stripe", "tiktok", "taboola", "onesignal", "css", "intercom"].some(str => url.includes(str))) {
                request.abort()
            } else {
                request.continue()
            }
        });

        await this.page.goto('https://bloxflip.com')

        log("clearing cloudflare data")
        await this.session.send('Network.clearBrowserCookies')
        await this.page.evaluate(() => localStorage.clear())

        await this.page.evaluate(() => {
            window.bloxflipClients = new Map()
        });

        this.browser.on('disconnected', () => {
            process.exit(0);
        });

        log("init")
        return true
    }

    async connect(auth) {
        await this.ready;
        const clientId = Date.now().toString();
        await this.page.evaluate((clientId, auth, namespaces) => {
            return new Promise((resolve, reject) => {
                const client = {
                    auth,
                    namespaces,
                    ws: null,
                    isReady: false,
                    readyPromise: null,
                    eventListeners: {},

                    connect: function() {
                        this.ws = new WebSocket('wss://ws.bloxflip.com/socket.io/?EIO=3&transport=websocket');
                        this.readyPromise = new Promise((resolveReady, rejectReady) => {
                            this.ws.onopen = async () => {
                                try {
                                    // init
                                    await Promise.all(this.namespaces.map(namespace => this.ws.send(`40/${namespace},`)));
                                    setTimeout(async () => {
                                        // authenicate
                                        await Promise.all(this.namespaces.map(namespace => this.ws.send(`42/${namespace},["auth","${this.auth}"]`)));
                                        this.isReady = true;

                                        // prevent socket closing
                                        setInterval(() => this.ws.send("2"), 20000);
                                        this.ws.timeout = 3000000;

                                        resolveReady();
                                    }, 500);
                                } catch (error) {
                                    rejectReady(error);
                                }
                            };

                            this.ws.onerror = rejectReady;
                        });
                        this.ws.onmessage = (event) => {
                            if (this.eventListeners['message']) {
                                this.eventListeners['message'].forEach(callback => callback(event.data));
                            }
                        };
                        this.ws.onclose = () => {
                            if (this.eventListeners['close']) {
                                this.eventListeners['close'].forEach(callback => callback());
                            }
                        };
                    },

                    emit: async function(namespace, event, data) {
                        await this.readyPromise;
                        this.ws.send(`42/${namespace},[${JSON.stringify(event)},${JSON.stringify(data)}]`);
                    },

                    send: async function(data) {
                        await this.readyPromise;
                        this.ws.send(data);
                    },

                    on: function(event, callback) {
                        if (!this.eventListeners[event]) {
                            this.eventListeners[event] = [];
                        }
                        this.eventListeners[event].push(callback);
                    },

                    close: function() {
                        if (this.ws) {
                            this.ws.close();
                        }
                    }
                };

                client.connect();
                window.bloxflipClients.set(clientId, client);
                client.readyPromise.then(resolve).catch(reject);
            });
        }, clientId, auth, this.namespaces);

        this.clients.set(clientId, {
            emit: this.emit.bind(this, clientId),
            send: this.send.bind(this, clientId),
            on: this.on.bind(this, clientId),
            close: this.closeClient.bind(this, clientId)
        });

        return this.clients.get(clientId);
    }

    async emit(clientId, namespace, event, data) {
        try {
            return await this.page.evaluate((clientId, namespace, event, data) => {
                const client = window.bloxflipClients.get(clientId);
                return client.emit(namespace, event, data);
            }, clientId, namespace, event, data);
        } catch (error) {
            // i dont think its a good idea logging errors since packets drop so often
            //console.error(error);
        }
    }
    
    async send(clientId, data) {
        try {
            return await this.page.evaluate((clientId, data) => {
                const client = window.bloxflipClients.get(clientId);
                return client.send(data);
            }, clientId, data);
        } catch (error) {
            // same here
            //console.error(error);
        }
    }
    

    async on(clientId, event, callback) {
        const callbackName = `raper_${clientId}_${event}`;
        await this.page.exposeFunction(callbackName, callback);
        await this.page.evaluate((clientId, event, callbackName) => {
            const client = window.bloxflipClients.get(clientId);
            client.on(event, (data) => {
                window[callbackName](data);
            });
        }, clientId, event, callbackName);
    }

    async closeClient(clientId) {
        await this.page.evaluate((clientId) => {
            const client = window.bloxflipClients.get(clientId);
            if (client) {
                client.close();
                window.bloxflipClients.delete(clientId);
            }
        }, clientId);
        this.clients.delete(clientId);
    }

    async close() {
        for (const clientId of this.clients.keys()) {
            await this.closeClient(clientId);
        }
        if (this.browser) {
            await this.browser.close();
        }
    }
}

module.exports = BloxflipRaper;
