/* jshint node:true, esnext:true, unused:true */
/*
 * druid-irc.js
 * Copyright (C) 2014 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

"use strict";

const irc = require("irc");
const common = require("./druid-common");


const IrcError = exports.IrcError = common.Error.extend({
	init: function (obj) {
		this.__init("[irc] " + (typeof(obj) === "string") ? obj : obj.toString());
	},
});


const IrcRequest = exports.IrcRequest = common.Request.extend({
	init: function (connection, from, to, message) {
		this.__init(connection, from, to, message);
		this._replyto = (to[0] == "#") ? to : from;
	},

	getBotName: function () {
		return this.connection.getNick();
	},

  sendReply: function () {
		if (this._reply) {
			this.connection.send(this._replyto, this._reply);
		}
	},
});


const IrcConnection = exports.IrcConnection = common.Connection.extend({
	init: function (config) {
		this._client = null;
		this._host = config.host;
		this._port = (config.port !== undefined) ? config.port : 6667;
		this._nick = config.nick;
		this._config = config;
		this.__init();
	},

	getNick: function () {
		return this._nick;
	},

	getLogPrefix: function () {
		return "[irc] " + this._host + ":" + this._port + "/" + this._nick;
	},

	connect: function () {
		let options = {
			showErrors: true,
			realName: "Druid-based IRC Bot",
		};

		for (let k in this._config) {
			if (k === "host") continue;
			if (k === "nick") continue;
			options[k] = this._config[k];
		}

		this._client = new irc.Client(this._host, this._nick, options);

		let self = this;
		this._client.addListener("connect", function () {
			self.logInfo("connected");
		});
		this._client.addListener("motd", function (motd) {
			self.logInfo("MOTD message received");
		});
		this._client.addListener("message", function (from, to, message) {
			self.trigger("request", new IrcRequest(self, from, to, message));
		});
		this._client.addListener("error", function (err) {
			self.logError("error:" + err.toString());
		});
	},

	send: function (to, text) {
		this._client.say(to, text);
	},
});
