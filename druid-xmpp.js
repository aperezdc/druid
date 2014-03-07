/* jshint node:true, esnext:true, unused:true */
/*
 * druid-xmpp.js
 * Copyright (C) 2014 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

"use strict";

const common = require("./druid-common");
const xmpp = require("node-xmpp");

const NS_CHATSTATES   = "http://jabber.org/protocol/chatstates";
const NS_MUC          = "http://jabber.org/protocol/muc";
const NS_PING         = "urn:xmpp:ping";

const PRESENCE_ONLINE = "online";
const PRESENCE_CHAT   = "chat";
const PRESENCE_AWAY   = "away";
const PRESENCE_DND    = "dnd";
const PRESENCE_XA     = "xa";

const STATE_COMPOSING = "composing";
const STATE_ACTIVE    = "active";
const STATE_INACTIVE  = "inactive";
const STATE_PAUSED    = "paused";
const STATE_GONE      = "gone";


const XmppError = exports.XmppError = common.Error.extend({
	init: function (obj) {
		this.__init("[xmpp] " + (typeof(obj) === "string") ? obj : obj.toString());
	},
});


const XmppRequest = common.Request.extend({
	init: function (connection, stanza) {
		this.room = null;

		let message = null;
		let replyto = null;
		let from = null;
		let to = null;

		if (stanza.is("message")) {
			message = stanza.getChildText("body");
			from = replyto = stanza.attrs.from;
			to = stanza.attrs.to;
			if (stanza.attrs.type === "groupchat") {
				let temp = stanza.attrs.from.split("/");
				this.room = replyto = temp[0];
				from = temp[1];
			}
		}

		this._replyto = replyto;
		this.__init(connection, from, to, message);
	},

	getBotName: function () {
		let name = this.connection._rooms[this.room];
		return name ? name : this.connection._connArgs.jid;
	},

	sendReply: function () {
		if (this._reply) {
			this.connection.send(new xmpp.Element("message", { to: this._replyto,
				type: (this.room ? "groupchat" : "chat") }).c("body").t(this._reply));
		}
	},
});


const XmppConnection = exports.XmppConnection = common.Connection.extend({
	init: function (config) {
		this._connArgs = {
			jid: config.jid,
			password: config.password,
			host: config.host,
			port: config.port,
			reconnect: true,
		};
		this._rooms = config.rooms;
		this._conn = null;
		this.__init();
	},

	getLogPrefix: function () {
		let host = (this._connArgs.host !== undefined) ? this._connArgs.host : null;
		let port = (this._connArgs.port !== undefined) ? this._connArgs.port : null;

		if (host === null)
			host = this._connArgs.jid.split("@")[1];
		if (port === null)
			port = 5552;
			
		return "[xmpp] " + host + ":" + port + "/" + this._connArgs.jid;
	},

	connect: function () {
		let self = this;
		self._conn = new xmpp.Client(self._connArgs);
		self._conn.connection.socket.setTimeout(0);
		self._conn.connection.socket.setKeepAlive(true, 10000);
		self._conn.on("online", function () { self._onOnline(); });
		self._conn.on("stanza", function (s) { self._onStanza(s); });
	},

	send: function (stanza) {
		return this._conn.send(stanza);
	},

	setPresence: function (show, state) {
		let elem = new xmpp.Element("presence", {});
		if (show && show !== PRESENCE_ONLINE)
			elem.c("show").t(show);
		if (typeof(state) === "string")
			elem.c("status").t(state);
		this.send(elem);
	},

	join: function (roomJid) {
		let elem = new xmpp.Element("presence", { to: roomJid })
			.c("x", { xmlns: NS_MUC }).up();
		this.send(elem);
	},

	_onOnline: function () {
		this.logInfo("connected");
		this.setPresence(PRESENCE_ONLINE);
		for (let room in this._rooms) {
			let roomJid = room + "/" + this._rooms[room];
			this.logInfo("joining " + roomJid);
			this.join(roomJid);
		}

		// Sending spaces over the wire works as application-level keepalive
		// mechanism for those cases in which TCP keepalices are not enough
		// (e.g. routers which keep track of data bytes passed on the wire
		// to determine whether a connection is alive).
		let self = this;
		setInterval(function () {
			self.logInfo("sending application-level keepalive");
			self._conn.connection.send(" ");
		}, 30000);
	},

	_onStanza: function (stanza) {
		if (stanza.is("message")) {
			let request = new XmppRequest(this, stanza);
			// XXX XMPP servers echo back sent messages, so ignore
			//     all the messages originating from the bot itself.
			if (request.getBotName() !== request.from) {
				this.trigger("request", request);
			}
			return;
		}
		if (stanza.is("presence")) {
			this.logInfo("ignoring presence stanza");
			return;
		}
		if (stanza.is("iq")) {
			this.logInfo("ignoring iq stanza");
			return;
		}
		this.logWarn("unhandled " + stanza.name + " stanza");
	},
});

