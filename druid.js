/*
 * druid.js
 * Copyright (C) 2013 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

require("./classy");
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


var Error = Class.$extend({
	__init__: function (text) {
		this.text = text;
	},
	toString: function () {
		return this.text;
	},
});
exports.Error = Error;


var InternalError = Error.$extend({});
exports.InternalError = InternalError;


var XmppError = Error.$extend({
	__init__: function (stanza) {
		this.$super(stanza.toString());
		this.stanza = stanza;
	},
});
exports.XmppError = XmppError;


var Request = Class.$extend({
	__init__: function (bot, stanza) {
		if (stanza.attrs.type == "error") {
			throw new XmppError(stanza);
		}

		this._ended = false;
		this.bot = bot;
		this.stanza = stanza;
		this.replyto = null;
		this.message = null;
		this.room = null;
		this.from = null;
		this.to = null;

		if (stanza.is("message")) {
			this.message = stanza.getChildText("body");
			this.from = this.replyto = stanza.attrs.from;
			this.to = stanza.attrs.to;
			if (stanza.attrs.type == "groupchat") {
				this.message = stanza.getChildText("body");
				var temp = stanza.attrs.from.split("/");
				this.room = this.replyto = temp[0];
				this.from = temp[1];
			}
		}
	},

	reply: function (text) {
		if (!this._ended) {
			this.bot.send(new xmpp.Element("message", { to: this.replyto,
				type: (this.room ? "groupchat" : "chat") }).c("body").t(text));
		}
		return this;
	},

	start: function () {
		if (!this._ended) {
			this.setState(STATE_ACTIVE);
		}
		return this;
	},
	
	end: function (text) {
		if (!this._ended) {
			this.setState(STATE_INACTIVE);
			this._ended = true;
		}
		return this;
	},

	replyLater: function () {
		return this.setState(STATE_COMPOSING);
	},

	setState: function (state) {
		if (!this._ended) {
			this.bot.setState(this.replyto, state, this.room !== null);
		}
		return this;
	},

	isMessage: function () {
		return this.message !== null;
	},
	isMucMessage: function () {
		return this.message !== null && this._room !== null;
	},
});


var Trigger = Class.$extend({
	__init__: function (regexp, callback, snoop) {
		if (typeof(callback) !== "function") {
			throw new Error("Callback argument is not a function");
		}
		this.snoop = (typeof(snoop) === "undefined") ? true : snoop;
		this._regexp = regexp;
		this._callback = callback;
	},

	matches: function (text) {
		if (this._regexp) {
			var matches = [];
			if (this._regexp.global) {
				var match = null;
				while ((match = this._regexp.exec(text)) !== null) {
					for (var i = 1; i < match.length; i++) {
						matches[matches.length] = match[i];
					}
				}
			} else {
				var match = this._regexp.exec(text);
				if (match) {
					for (var i = 1; i < match.length; i++) {
						matches[matches.length] = match[i];
					}
				}
			}
			return (matches.length > 0) ? matches : null;
		}
		return null;
	},

	run: function (request) {
		var matches = this.matches(request.message);
		return (matches !== null) ? this._callback(request.start(), matches) : false;
	},
});
exports.Trigger = Trigger;


var Command = Trigger.$extend({
	__init__: function (name, callback) {
		if (typeof(callback) !== "function") {
			throw new Error("Callback argument is not a function");
		}
		var self = this;
		this._cmd_callback = callback;
		this.$super(new RegExp("^\\s*(" + name + ")\\s+(.*)$"), function (request, matches) {
			if (matches.length != 2) {
				throw new InternalError("More than one regexp match for Command");
			}
			self._cmd_callback(request, matches[0], matches[1]);
			return true;
		}, false);
	},
});


var builtins = {
	Status: new Command("status", function (request, cmd, args) {
		request.bot.setStatus(args.trim());
	}),
};
exports.builtins = builtins;


var Bot = Class.$extend({
	__init__: function (config) {
		this._connArgs = {
			jid: config.jid,
			password: config.password,
			host: config.host,
	 		port: config.port,
			reconnect: true
		};
		this._rooms = config.rooms;
		this._triggers = [];
	},

	run: function () {
		var self = this;
		self._conn = new xmpp.Client(self._connArgs);
		self._conn.connection.socket.setTimeout(0);
		self._conn.connection.socket.setKeepAlive(true, 10000);
		self._conn.on("online", function () { return self._onOnline(); });
		self._conn.on("stanza", function (s) { return self._onStanza(s); });
	},

	setPresence: function (show, state) {
		var elem = new xmpp.Element("presence", {});
		if (show && show !== "online") {
			elem.c("show").t(show);
		}
		if (typeof(state) !== "undefined") {
			elem.c("status").t(state);
		}
		this.send(elem);
	},

	setState: function (to, state, muc) {
		if (muc && state === STATE_GONE) {
			throw new Error("Cannot send 'gone' states to MUC group chats");
		}
		var elem = new xmpp.Element("message", { to: to,
			type: (muc ? "groupchat" : "chat")}).c(state, { xmlns: NS_CHATSTATES }).up();
		this.send(elem);
	},

	ping: function () {
		var elem = new xmpp.Element("iq", { from: conn.jid, type: "get", id: "c2s1" })
			.c("ping", { xmlns: NS_PING });
		this.send(elem);
	},

	join: function (roomJid) {
		var elem = new xmpp.Element("presence", { to: roomJid })
			.c("x", { xmlns: NS_MUC }).up();
		this.send(elem);
	},

	mucMessage: function (jid, text) {
		return new xmpp.Element("message", { to: jid, type: "groupchat" })
			.c("body").t(text);
	},

	send: function (stanza) {
		return this._conn.send(stanza);
	},

	addTrigger: function (trigger) {
		if (!(trigger instanceof Trigger)) {
			throw new Error("Argument is not a Trigger");
		}
		this._triggers[this._triggers.length] = trigger;
	},

	addBuiltins: function () {
		for (var k in builtins) {
			this.addTrigger(builtins[k]);
		}
	},

	_onOnline: function () {
		console.info("druid: Connected");
		this.setPresence(PRESENCE_ONLINE);
		for (var room in this._rooms) {
			var roomJid = room + "/" + this._rooms[room];
			console.info("druid: Joining", roomJid);
			this.join(roomJid);

			// XXX Sending the first state to the chatroom before the server
			//     ACKs the presence makes the server notify an error.
			//this.setState(roomJid, STATE_INACTIVE, true);
		}

		// Sending spaces over the wire works as a keepalive mechanism,
		// for those cases in which TCP keepalives are not enough (e.g.
		// routers which keep track of data bytes passed on the wire).
		var self = this;
		setInterval(function () {
			console.log("druid: Sending application-level keepalive");
			self._conn.connection.send(" ");
		}, 30000);
	},

	_onClose: function () {
		console.info("druid: Connection closed");
	},

	_onStanza: function (stanza) {
		if (stanza.is("message")) {
			this._onMessageStanza(stanza);
			return;
		}
		if (stanza.is("presence")) {
			console.warn("druid: Ignoring presence stanza");
			return;
		}
		if (stanza.is("iq")) {
			console.warn("druid: Ignoring iq stanza");
			return;
		}
		console.warn("druid: Unhandled", stanza.name, "stanza");
	},

	_onMessageStanza: function (stanza) {
		try {
			var request = new Request(this, stanza);
			if (request.isMucMessage() && this._rooms[request.room]) {
				for (var i = 0; i < this._triggers.length; i++) {
					var trigger = this._triggers[i];
					if (trigger.snoop) {
						if (trigger.run(request)) {
							break;
						} else {
							continue;
						}
					}

					var match = request.message.match("^\\s*" + this._rooms[request.room] + "[:,]\\s*(.*)$");
					if (match) {
						request.message = match[1];
						if (this._triggers[i].run(request)) {
							break;
						}
					}
				}
			}
		} catch (e) {
			this._onError(e);
		}
	},

	_onError: function (error) {
		throw error;
	},
});

exports.Bot = Bot;

