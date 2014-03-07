/* jshint node:true, esnext:true, unused:true */
/*
 * druid-common.js
 * Copyright (C) 2013-2014 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

"use strict";

const Class = require("fishbone");

const Error = exports.Error = Class({
	init: function (text) {
		this.text = text;
	},
	toString: function () {
		return this.text;
	},
});


const InternalError = exports.InternalError =
		exports.Error.extend({});
const NotImplementedError = exports.NotImplementedError =
		exports.Error.extend({});


exports.Request = Class({
	NEW     : "new",
	AGAIN   : "again",
	ACCEPTED: "accepted",
	DONE    : "done",

	init: function (connection, from, to, message) {
		this.connection = connection;
		this.state = this.NEW;
		this.mention = false;
		this.message = null;
		this.from = from;
		this.to = to;
		this._reply = null;
		this._reply_last_line = null;
		this._setMessage(message);
	},

	_setMessage: function (message) {
		this.message = message;
		if (message) {
			let match = this.message.match("^\\s*" + this.getBotName() + "[:,]\\s*(.*)$");
			if (match) {
				this.mention = true;
				this.message = match[1];
			}
		}
	},

	getBotName: function () {
		throw new NotImplementedError("Request.getBotName");
	},

	reply: function (text) {
		if (this.state === this.DONE || this.state === this.AGAIN) {
			throw new Error("Cannot use reply() on a '" + this.state + "' request");
		}
		if (this._reply === null) {
			this._reply = text;
		} else {
			this._reply = this._reply + "\n" + text;
		}
		this._reply_last_line = text;
	},

	again: function (message) {
		if (this.state !== this.NEW && this.state !== this.ACCEPTED) {
			throw new Error("Cannot use again() on a '" + this.state + "' request");
		}
		if (message !== false) {
			this._setMessage(message || this._reply_last_line);
		}
		this.state = this.AGAIN;
		this.trigger("again", this);
	},

	finish: function () {
		if (this.state === this.DONE) {
			throw new Error("Cannot use finish() on a '" + this.state + "' request");
		}
		this.state = this.DONE;
		this.trigger("finish", this);
	},

	restart: function () {
		if (this.state !== this.AGAIN) {
			throw new Error("Cannot use finish() on a '" + this.state + "' request");
		}
		this.state = this.NEW;
	},

	accept: function () {
		if (this.state !== this.NEW && this.state !== this.ACCEPTED) {
			throw new Error("Cannot use accept() on a '" + this.state + "' request");
		}
		this.state = this.ACCEPTED;
	},

	sendReply: function () {
		throw new NotImplementedError("Request.sendReply");
	},

	isMessage: function () {
		return this.message !== null;
	},

	isDirectMessage: function () {
		return this.message !== null && (this.room === null);
	},

	toString: function () {
		return "[Request " + this.state + " '" + this.message + "']";
	},
});


const Trigger = exports.Trigger = Class({
	init: function (regexp, snoop) {
		this.snoop = (snoop === undefined) ? true : !!snoop;
		this.regexp = regexp;
	},

	handleMatch: function (request, match) {
		throw new NotImplementedError("Trigger.handleMatch");
	},

	matches: function (text) {
		let matches = [];
		if (this.regexp.global) {
			let match = null;
			while ((match = this.regexp.exec(text)) !== null) {
				let m = [];
				for (let i = 1; i < match.length; i++) {
					m[m.length] = match[i];
				}
				matches[matches.length] = m;
			}
		} else {
			let match = this.regexp.exec(text);
			if (match) {
				let m = [];
				for (let i = 1; i < match.length; i++) {
					m[m.length] = m;
				}
				matches[matches.length] = m;
			}
		}
		return (matches.length > 0) ? matches : null;
	},

	run: function (request) {
		let matches = this.matches(request.message);
		if (matches === null) {
			return false;
		}

		for (let i = 0; i < matches.length; i++) {
			this.handleMatch(request, matches[i]);
		}
	},

	toString: function () {
		let s = "[Trigger \"" + this.regexp.toString();
		if (this.snoop)
			s = s + " snoop";
		return s + "]";
	},
});


const Command = exports.Command = Trigger.extend({
	init: function (name, callback) {
		if (typeof(callback) === "function") {
			this.handleCommand = callback;
		}
		this.__init(new RegExp("^\\s*(" + name + ")\\s+(.*)$"), false);
	},
	
	handleMatch: function (request, matches) {
		if (matches.length !== 2) {
			throw new InternalError("More than one regexp match for Command");
		}
		this.handleCommand(request, matches[0], matches[1]);
		request.finish();
	},

	handleCommand: function (request, name, argument) {
		throw new NotImplementedError("Command.handleCommand");
	},
});


/**
 * Triggers:
 *   - "request" (Request)
 */
const Connection = exports.Connection = Class({
	init: function () {
		this._logPrefix = this.getLogPrefix();
	},

	connect: function () {
		throw new NotImplementedError("Connection.connect");
	},

	getLogPrefix: function () {
		throw new NotImplementedError("Connection.getLogPrefix");
	},

	logInfo: function (text) {
		console.log(this._logPrefix + ": " + text);
	},

	logWarn: function (text) {
		console.warn(this._logPrefix + ": " + text);
	},

	logError: function (text) {
		console.error(this._logPrefix + ": " + text);
	},
});


const Bot = exports.Bot = Class({
	init: function () {
		this._connections = [];
		this._triggers = [];
	},

	addConnection: function (connection) {
		// XXX Check does not work with fishbone!
		//if (!(connection instanceof Connection))
		//	throw new Error("argument is not a Connection");
		this._connections[this._connections.length] = connection;

		var self = this;
		connection.on("request", function (r) {
			// XXX Handlers are installed when the Request is received from
			//     the Connection, this way they are wired just once.
			r.on("again", function (r) { self.handleRequest(r.restart()); });
			r.on("finish", function (r) { r.sendReply(); });

			self.handleRequest(r);
		});
	},

	addTrigger: function (trigger) {
		// XXX Check does not work with fishbone!
		//if (!(trigger instanceof Trigger))
		//	throw new Error("argument is not a Trigger");
		this._triggers[this._triggers.length] = trigger;
	},

	addPlugin: function (plugin, config) {
		if (typeof(plugin) === "string")
			plugin = require("./druid-plugin-" + plugin);
		if (typeof(plugin.configure) !== "function")
			throw new Error("Invalid plugin passed to Bot.addPlugin");
		plugin.configure(this, config);
	},

	run: function () {
		for (let i = 0; i < this._connections.length; i++) {
			this._connections[i].connect();
		}
	},

	handleRequest: function (request) {
		if (!request.isMessage()) {
			console.warn("[bot] Ignored non-message: " + request.toString());
			return;
		}

		for (let i = 0; i < this._triggers.length; i++) {
			let trigger = this._triggers[i];
			if (trigger.snoop || request.mention || request.isDirectMessage()) {
				trigger.run(request);
				if (request.state !== request.NEW)
					break;
			}
		}
	},
});
