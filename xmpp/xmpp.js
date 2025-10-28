require("dotenv").config();
const WebSocket = require("ws").Server;
const XMLBuilder = require("xmlbuilder");
const XMLParser = require("xml-parser");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const https = require("https");
const express = require("express");
const app = express();

const User = require("../database/models/user.js");
const Friends = require("../database/models/friends.js");

/*const httpsOptions = {
    cert: fs.readFileSync("./certs/certificate.pem", "utf8"),
    ca: fs.readFileSync("./certs/ca-bundle.pem", "utf8"),
    key: fs.readFileSync("./certs/private-key.pem", "utf8")
};*/

const port = Number(process.env.XMPP_PORT) || 8080;
//const httpsServer = https.createServer(httpsOptions, app);
const wss = new WebSocket({ server: app.listen(port) });
//const wss = new WebSocket({ port: 3551 });
//httpsServer.listen(port);

app.use(express.json());

global.xmppDomain = "prod.ol.epicgames.com";
global.Clients = [];
global.sortedClients = {};
global.MUCs = {};
global.serverOnline = [];

app.get("/", (req, res) => {
    res.type("application/json");

    let data = JSON.stringify({
        "Clients": {
            "amount": global.Clients.length,
            "clients": global.Clients.map(i => i.displayName),
            "sortedClients": global.sortedClients
        }
    }, null, 2);

    return res.send(data);
});

app.get("/clients", (req, res) => {
    res.type("application/json");

    let data = JSON.stringify({
        "amount": global.Clients.length,
        "clients": global.Clients.map(i => i.displayName),
        "sortedClients": global.sortedClients
    }, null, 2);

    return res.send(data);
});

wss.on('listening', () => {
    logger.xmpp(`XMPP and Matchmaker started listening on port ${port}`);
});

wss.on('connection', async (ws, req) => {
    ws.on('error', () => { });

    const host = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    let joinedMUCs = [];
    let accountId = "";
    let displayName = "";
    let token = "";
    let jid = "";
    let resource = "";
    let ID = "";
    let Authenticated = false;
    let clientExists = false;
    let connectionClosed = false;
    let decodedToken = {};
    let clientId = "";
    /*if (ws.protocol.toLowerCase() != "xmpp") {
        await matchmaker(ws, req);
    }*/

    ws.on('message', async (message) => {
        if (Buffer.isBuffer(message)) message = message.toString();
        const msg = XMLParser(message);
        if (!msg || !msg.root || !msg.root.name) return Error(ws);
        //console.log(msg.root);
        switch (msg.root.name) {
            case "open":
                if (!ID) ID = uuidv4();

                ws.send(XMLBuilder.create("open")
                    .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-framing")
                    .attribute("from", global.xmppDomain)
                    .attribute("id", ID)
                    .attribute("version", "1.0")
                    .attribute("xml:lang", "en").toString());

                if (Authenticated) {
                    ws.send(XMLBuilder.create("stream:features").attribute("xmlns:stream", "http://etherx.jabber.org/streams")
                        .element("ver").attribute("xmlns", "urn:xmpp:features:rosterver").up()
                        .element("starttls").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-tls").up()
                        .element("bind").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-bind").up()
                        .element("compression").attribute("xmlns", "http://jabber.org/features/compress")
                        .element("method", "zlib").up().up()
                        .element("session").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-session").up().toString());
                } else {
                    ws.send(XMLBuilder.create("stream:features").attribute("xmlns:stream", "http://etherx.jabber.org/streams")
                        .element("mechanisms").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-sasl")
                        .element("mechanism", "PLAIN").up().up()
                        .element("ver").attribute("xmlns", "urn:xmpp:features:rosterver").up()
                        .element("starttls").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-tls").up()
                        .element("compression").attribute("xmlns", "http://jabber.org/features/compress")
                        .element("method", "zlib").up().up()
                        .element("auth").attribute("xmlns", "http://jabber.org/features/iq-auth").up().toString());
                }
                break;
            case "auth":
                try {
                    if (accountId) return;
                    if (!msg.root.content) return Error(ws);
                    let decoded;
                    if (!DecodeBase64(msg.root.content).includes("\u0000")) {
                        token = msg.root.content.replace("eg1~", "");
                        decoded = jwt.verify(token, process.env.JWT_SECRET)
                    } else {
                        let decodedBase64 = DecodeBase64(msg.root.content).split("\u0000");

                        if (decodedBase64.length < 3) return Error(ws);
                        token = decodedBase64[2].replace("eg1~", "");

                        decoded = jwt.verify(token, process.env.JWT_SECRET)
                    }
                    decodedToken = decoded;
                    accountId = decoded.account_id;
                    clientId = decoded.client_Id;

                    if (!accountId) return Error(ws);

                    if (global.Clients.find(i => i.accountId === accountId)) return Error(ws);

                    const user = await User.findOne({ 'accountInfo.id': accountId });
                    if (!user) return Error(ws);

                    displayName = user.accountInfo.displayName;

                    if (accountId && displayName && token) {
                        Authenticated = true;
                        logger.xmpp(`An xmpp client with the displayName ${displayName} has logged in.`);
                        user.accountInfo.last_online = new Date().toISOString();
                        await user.save();
                        ws.send(XMLBuilder.create("success").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-sasl").toString());
                    } else return Error(ws);
                } catch (err) {
                    console.error(err);
                    ws.send(XMLBuilder.create("faliure").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-sasl").toString());
                }
                break;
            case "iq":
                if (!ID) return;

                switch (msg.root.attributes.id) {
                    case "_xmpp_bind1":
                        if (resource || !accountId) return;
                        if (!msg.root.children.find(i => i.name == "bind")) return;

                        if (global.Clients.find(i => i.accountId == accountId)) return Error(ws);

                        let findResource = msg.root.children.find(i => i.name == "bind").children.find(i => i.name == "resource");

                        if (!findResource) return;
                        if (!findResource.content) return;

                        resource = findResource.content;
                        jid = `${accountId}@${global.xmppDomain}/${resource}`;

                        ws.send(XMLBuilder.create("iq")
                            .attribute("xmlns", "jabber:client")
                            .attribute("id", "_xmpp_bind1")
                            .attribute("type", "result")
                            .attribute("to", jid)
                            .element("bind")
                            .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-bind")
                            .element("jid", jid).up().up().toString());
                        break;

                    case "_xmpp_session1":
                        if (!clientExists) return Error(ws);

                        ws.send(XMLBuilder.create("iq")
                            .attribute("to", jid)
                            .attribute("from", global.xmppDomain)
                            .attribute("id", "_xmpp_session1")
                            .attribute("xmlns", "jabber:client")
                            .attribute("type", "result").toString());

                        await getPresenceFromFriends(ws, accountId, jid);
                        break;

                    default:
                        if (!clientExists) return Error(ws);

                        ws.send(XMLBuilder.create("iq")
                            .attribute("to", jid)
                            .attribute("from", global.xmppDomain)
                            .attribute("id", msg.root.attributes.id)
                            .attribute("xmlns", "jabber:client")
                            .attribute("type", "result").toString());
                }
                break;
            case "message":
                if (!clientExists) return Error(ws);

                let findBody = msg.root.children.find(i => i.name == "body");

                if (!findBody || !findBody.content) return;

                let body = findBody.content;

                switch (msg.root.attributes.type) {
                    case "chat":
                        if (!msg.root.attributes.to) return;
                        if (body.length >= 300) return;

                        let receiver = global.Clients.find(i => i.jid.split("/")[0] == msg.root.attributes.to);

                        if (!receiver) return;
                        if (receiver.accountId == accountId) return;

                        receiver.client.send(XMLBuilder.create("message")
                            .attribute("to", receiver.jid)
                            .attribute("from", jid)
                            .attribute("xmlns", "jabber:client")
                            .attribute("type", "chat")
                            .element("body", body).up().toString());
                        return;

                    case "groupchat":
                        if (!msg.root.attributes.to) return;
                        if (body.length >= 300) return;

                        let roomName = msg.root.attributes.to.split("@")[0];

                        let MUC = global.MUCs[roomName];
                        if (!MUC) return;

                        if (!MUC.members.find(i => i.accountId == accountId)) return;

                        MUC.members.forEach(member => {
                            let ClientData = global.Clients.find(i => i.accountId == member.accountId);
                            if (!ClientData) return;

                            ClientData.client.send(XMLBuilder.create("message")
                                .attribute("to", ClientData.jid)
                                .attribute("from", getMUCmember(roomName, displayName, accountId, resource))
                                .attribute("xmlns", "jabber:client")
                                .attribute("type", "groupchat")
                                .element("body", body).up().toString());
                        });
                        return;
                }

                if (isJSON(body)) {
                    let bodyJSON = JSON.parse(body);

                    if (Array.isArray(bodyJSON)) return;
                    if (typeof bodyJSON.type != "string") return;
                    if (!msg.root.attributes.to) return;
                    if (!msg.root.attributes.id) return;

                    sendXmppMessageToClient(jid, msg, body);
                }
                break;
            case "presence":
                if (!clientExists) return Error(ws);

                switch (msg.root.attributes.type) {
                    case "unavailable":
                        if (!msg.root.attributes.to) return;

                        if (msg.root.attributes.to.endsWith(`@muc.${global.xmppDomain}`) || msg.root.attributes.to.split("/")[0].endsWith(`@muc.${global.xmppDomain}`)) {
                            if (!msg.root.attributes.to.toLowerCase().startsWith("party-")) return;

                            let roomName = msg.root.attributes.to.split("@")[0];

                            if (!global.MUCs[roomName]) return;

                            let memberIndex = global.MUCs[roomName].members.findIndex(i => i.accountId == accountId);
                            if (memberIndex != -1) {
                                global.MUCs[roomName].members.splice(memberIndex, 1);
                                joinedMUCs.splice(joinedMUCs.indexOf(roomName), 1);
                            }

                            ws.send(XMLBuilder.create("presence")
                                .attribute("to", jid)
                                .attribute("from", getMUCmember(roomName, displayName, accountId, resource))
                                .attribute("xmlns", "jabber:client")
                                .attribute("type", "unavailable")
                                .element("x").attribute("xmlns", "http://jabber.org/protocol/muc#user")
                                .element("item")
                                .attribute("nick", getMUCmember(roomName, displayName, accountId, resource).replace(`${roomName}@muc.${global.xmppDomain}/`, ""))
                                .attribute("jid", jid)
                                .attribute("role", "none").up()
                                .element("status").attribute("code", "110").up()
                                .element("status").attribute("code", "100").up()
                                .element("status").attribute("code", "170").up().up().toString());
                            return;
                        }
                        break;

                    default:
                        if (msg.root.children.find(i => i.name == "muc:x") || msg.root.children.find(i => i.name == "x")) {
                            if (!msg.root.attributes.to) return;

                            let roomName = msg.root.attributes.to.split("@")[0];

                            if (!global.MUCs[roomName]) global.MUCs[roomName] = { members: [] };

                            if (global.MUCs[roomName].members.find(i => i.accountId == accountId)) return;

                            global.MUCs[roomName].members.push({ accountId: accountId });

                            joinedMUCs.push(roomName);

                            ws.send(XMLBuilder.create("presence")
                                .attribute("to", jid)
                                .attribute("from", getMUCmember(roomName, displayName, accountId, resource))
                                .attribute("xmlns", "jabber:client")
                                .element("x").attribute("xmlns", "http://jabber.org/protocol/muc#user")
                                .element("item")
                                .attribute("nick", getMUCmember(roomName, displayName, accountId, resource).replace(`${roomName}@muc.${global.xmppDomain}/`, ""))
                                .attribute("jid", jid)
                                .attribute("role", "participant")
                                .attribute("affiliation", "none").up()
                                .element("status").attribute("code", "110").up()
                                .element("status").attribute("code", "100").up()
                                .element("status").attribute("code", "170").up()
                                .element("status").attribute("code", "201").up().up().toString());

                            global.MUCs[roomName].members.forEach(member => {
                                let ClientData = global.Clients.find(i => i.accountId == member.accountId);
                                if (!ClientData) return;

                                ws.send(XMLBuilder.create("presence")
                                    .attribute("from", getMUCmember(roomName, ClientData.displayName, ClientData.accountId, ClientData.resource))
                                    .attribute("to", jid)
                                    .attribute("xmlns", "jabber:client")
                                    .element("x")
                                    .attribute("xmlns", "http://jabber.org/protocol/muc#user")
                                    .element("item")
                                    .attribute("nick", getMUCmember(roomName, ClientData.displayName, ClientData.accountId, ClientData.resource).replace(`${roomName}@muc.${global.xmppDomain}/`, ""))
                                    .attribute("jid", ClientData.jid)
                                    .attribute("role", "participant")
                                    .attribute("affiliation", "none").up().up().toString());

                                if (accountId == ClientData.accountId) return;

                                ClientData.client.send(XMLBuilder.create("presence")
                                    .attribute("from", getMUCmember(roomName, displayName, accountId, resource))
                                    .attribute("to", ClientData.jid)
                                    .attribute("xmlns", "jabber:client")
                                    .element("x")
                                    .attribute("xmlns", "http://jabber.org/protocol/muc#user")
                                    .element("item")
                                    .attribute("nick", getMUCmember(roomName, displayName, accountId, resource).replace(`${roomName}@muc.${global.xmppDomain}/`, ""))
                                    .attribute("jid", jid)
                                    .attribute("role", "participant")
                                    .attribute("affiliation", "none").up().up().toString());
                            });
                            return;
                        }
                }

                let findStatus = msg.root.children.find(i => i.name == "status");

                if (!findStatus || !findStatus.content) return;
                if (!isJSON(findStatus.content)) return;
                if (Array.isArray(JSON.parse(findStatus.content))) return;

                let status = findStatus.content;
                let away = msg.root.children.find(i => i.name == "show") ? true : false;

                await updatePresenceForFriends(ws, status, away, false);
                functions.getPresenceFromUser(accountId, accountId, false, global.Clients);
                break;
        }
        if (!clientExists && !connectionClosed) {
            if (accountId && displayName && token && jid && ID && resource && Authenticated) {
                global.Clients.push({
                    client: ws,
                    clientId: clientId,
                    accountId: accountId,
                    displayName: displayName,
                    token: token,
                    jid: jid,
                    resource: resource,
                    lastPresenceUpdate: {
                        away: false,
                        status: "{}"
                    }
                });

                if (global.sortedClients[clientId]) {
                    global.sortedClients[clientId] = global.sortedClients[clientId] + 1;
                } else {
                    global.sortedClients[clientId] = 1;
                }

                clientExists = true;
            }
        }
    });

    ws.on('close', () => { connectionClosed = true; clientExists = false; RemoveClient(ws, joinedMUCs); });
})

function Error(ws) {
    ws.send(XMLBuilder.create("close").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-framing").toString());
    ws.close();
}

function RemoveClient(ws, joinedMUCs, clientId) {
    let clientIndex = global.Clients.findIndex(i => i.client == ws);
    let client = global.Clients[clientIndex];

    if (clientIndex == -1) return;

    let ClientStatus = JSON.parse(client.lastPresenceUpdate.status);

    updatePresenceForFriends(ws, "{}", false, true);

    global.Clients.splice(clientIndex, 1);

    for (let roomName of joinedMUCs) {
        if (global.MUCs[roomName]) {
            let memberIndex = global.MUCs[roomName].members.findIndex(i => i.accountId == client.accountId);

            if (memberIndex != -1) global.MUCs[roomName].members.splice(memberIndex, 1);
        }
    }

    let partyId = "";

    try {
        switch (true) {
            case (!ClientStatus.Properties): break;
            case (isObject(ClientStatus.Properties)): {
                for (let key in ClientStatus.Properties) {
                    if (key.toLowerCase().startsWith("party.joininfo")) {
                        if (isObject(ClientStatus.Properties[key])) partyId = ClientStatus.Properties[key].partyId;
                    }
                }
            }
        }
    } catch { }

    if (partyId && typeof partyId == "string") {
        global.Clients.forEach(ClientData => {
            if (client.accountId == ClientData.accountId) return;

            ClientData.client.send(XMLBuilder.create("message")
                .attribute("id", uuidv4().replace(/-/ig, "").toUpperCase())
                .attribute("from", client.jid)
                .attribute("xmlns", "jabber:client")
                .attribute("to", ClientData.jid)
                .element("body", JSON.stringify({
                    "type": "com.epicgames.party.memberexited",
                    "payload": {
                        "partyId": partyId,
                        "memberId": client.accountId,
                        "wasKicked": false
                    },
                    "timestamp": new Date().toISOString()
                })).up().toString());
        });
    }

    global.sortedClients[clientId] = global.sortedClients[clientId] - 1;

    logger.xmpp(`An xmpp client with the displayName ${client.displayName} has logged out.`);
    logger.xmpp(`Connected Clients: ${global.Clients.length}`);
}

async function getPresenceFromFriends(ws, accountId, jid) {
    let friends = await Friends.findOne({ accountId: accountId }).lean();
    if (!friends) return;

    let accepted = friends.list.accepted;

    accepted.forEach(friend => {
        let ClientData = global.Clients.find(i => i.accountId == friend.accountId);
        if (!ClientData) return;

        let xml = XMLBuilder.create("presence")
            .attribute("xmlns", "jabber:client")
            .attribute("id", friend.accountId)
            .attribute("corr-id", `FN-${uuidv4().replace(/-/g, '')}`)
            .attribute("to", jid)
            .attribute("from", ClientData.jid)
            .attribute("type", "available")

        if (ClientData.lastPresenceUpdate.away) xml = xml.element("show", "away").up().element("status", ClientData.lastPresenceUpdate.status).up();
        else xml = xml.element("status", ClientData.lastPresenceUpdate.status).up();

        ws.send(xml.toString());
    });
}

async function updatePresenceForFriends(ws, body, away, offline) {
    let SenderIndex = global.Clients.findIndex(i => i.client == ws);
    let SenderData = global.Clients[SenderIndex];

    if (SenderIndex == -1) return;

    global.Clients[SenderIndex].lastPresenceUpdate.away = away;
    global.Clients[SenderIndex].lastPresenceUpdate.status = body;

    let friends = await Friends.findOne({ accountId: SenderData.accountId });
    let accepted = friends.list.accepted;

    accepted.forEach(friend => {
        let ClientData = global.Clients.find(i => i.accountId == friend.accountId);
        if (!ClientData) return;

        let xml = XMLBuilder.create("presence")
            .attribute("to", ClientData.jid)
            .attribute("xmlns", "jabber:client")
            .attribute("from", SenderData.jid)
            .attribute("type", offline ? "unavailable" : "available");

        if (away) xml = xml.element("show", "away").up().element("status", body).up();
        else xml = xml.element("status", body).up();

        ClientData.client.send(xml.toString());
    });
}

function sendXmppMessageToClient(senderJid, msg, body) {
    if (typeof body == "object") body = JSON.stringify(body);

    let receiver = global.Clients.find(i => i.jid.split("/")[0] == msg.root.attributes.to || i.jid == msg.root.attributes.to);
    if (!receiver) return;

    receiver.client.send(XMLBuilder.create("message")
        .attribute("from", senderJid)
        .attribute("id", msg.root.attributes.id)
        .attribute("to", receiver.jid)
        .attribute("xmlns", "jabber:client")
        .element("body", `${body}`).up().toString());
}

function getMUCmember(roomName, displayName, accountId, resource) {
    return `${roomName}@muc.${global.xmppDomain}/${encodeURI(displayName)}:${accountId}:${resource}`;
}

function DecodeBase64(str) {
    return Buffer.from(str, 'base64').toString();
}

function isObject(value) {
    if (typeof value == "object" && !Array.isArray(value)) return true;
    else return false;
}

function isJSON(str) {
    try {
        JSON.parse(str)
    } catch (err) {
        return false;
    }
    return true;
}