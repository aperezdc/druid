/*
 * druid.js
 * Copyright (C) 2013 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

require("./classy");
const xmpp = require("node-xmpp");


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

		this.bot = bot;
		this.stanza = stanza;
		this.message = null;
		this.room = null;
		this.from = null;
		this.to = null;

		if (stanza.is("message")) {
			this.message = stanza.getChildText("body");
			this.from = stanza.attrs.from;
			this.to = stanza.attrs.to;
			if (stanza.attrs.type == "groupchat") {
				this.message = stanza.getChildText("body");
				var temp = stanza.attrs.from.split("/");
				this.room = temp[0];
				this.from = temp[1];
			}
		}
	},

	reply: function (text) {
		var message = null;
		if (this.room) {
			message = this.bot.mucMessage(this.room, text);
		} else {
			message = this.bot.message(this.from, text);
		}
		this.bot.send(message);
	},

	isMessage: function () {
		return this.message !== null;
	},
	isMucMessage: function () {
		return this.message !== null && this._room !== null;
	},
});


var Trigger = Class.$extend({
	__init__: function (regexp, callback) {
		if (typeof(callback) !== "function") {
			throw new Error("Callback argument is not a function");
		}
		this.snoop = false;
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
		return (matches !== null) ? this._callback(request, matches) : false;
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
		});
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

	setStatus: function (message) {
		var elem = new xmpp.Element("presence", {})
			.c("show").t("chat").up()
			.c("status").t(message);
		this._conn.send(elem);
	},

	ping: function () {
		var elem = new xmpp.Element("iq", { from: conn.jid, type: "get", id: "c2s1" })
			.c("ping", { xmlns: "urn:xmpp:ping" });
		this._conn.send(elem);
	},

	join: function (roomJid) {
		var elem = new xmpp.Element("presence", { to: roomJid })
			.c("x", { xmlns: "http://jabber.org/protocol/muc" });
		this._conn.send(elem);
	},

	message: function (jid, text) {
		return new xmpp.Element("message", { to: jid, type: "chat" })
			.c("body").t(text);
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
		this.setStatus("Available");
		for (var room in this._rooms) {
			var roomJid = room + "/" + this._rooms[room];
			this.join(roomJid);
		}

		// Sending spaces over the wire works as a keepalive mechanism,
		// for those cases in which TCP keepalives are not enough (e.g.
		// routers which keep track of data bytes passed on the wire).
		var self = this;
		setInterval(function () { self._conn.connection.send(" "); }, 30000);
	},
	_onStanza: function (stanza) {
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

