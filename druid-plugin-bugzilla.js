/* jshint node:true, esnext:true, unused:true */
/*
 * druid-plugin-bugzilla.js
 * Copyright (C) 2013-2014 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

"use strict";

const cache = require("lru-cache");
const request = require("request");
const cheerio = require("cheerio");
const Trigger = require("./druid-common").Trigger;


const ExpandBugId = Trigger.extend({
	init: function (prefix, baseurl) {
		this._prefix = prefix;
		this._baseurl = baseurl;
		this.__init(new RegExp("\\b" + prefix + "(?:\\s+bug\\s+)[:# ](\\d+)\\b", "ig"));
	},

	handleMatch: function (req, match) {
		req.reply(this._baseurl + "/show_bug.cgi?id=" + match[0]).again();
	},

	toString: function () {
		return "[bugzilla.ExpandBugId " + this._prefix + "]";
	},
});


const BugSummary = Trigger.extend({
	init: function (prefix, baseurl) {
		this._cache = cache({
			max: 500,              // Store 500 elements
			maxAge: 1000 * 60 * 3, // ...for a maximum of three minutes
			length: function (n) { return 1; },
		});
		this.prefix = prefix;
		this.baseurl = baseurl;
		this.__init(/\b(https?:\/\/[\w\.\/:-]+)\/show_bug\.cgi\?id=(\d+)\b/g);
	},

	handleMatch: function (req, match) {
		if (match[0] != this.baseurl)
			return;

		let url = this.baseurl + "/show_bug.cgi?id=" + match[1];
		if (this._cache.has(url)) {
			req.reply("#" + match[1] + " - " + this._cache.get(url)).finish();
			return;
		}

		let self = this;
		req.accept();
		request(url, function (error, response, body) {
			if (error) {
				console.log("[bugzilla] error: " + error);
				return;
			}

			let summary = null;
			try {
				summary = cheerio(body).find("span#short_desc_nonedit_display").text();
				if (!summary) {
					summary = "Not found / Invalid bug ID";
				}
			} catch (e) {
				console.log("[bugzilla] error: " + e);
			}

			if (summary) {
				self._cache.set(url, summary);
				req.reply("#" + match[1] + " - " + summary).finish();
			}
		});
	},

	toString: function () {
		return "[bugzilla.BugSummary " + this.prefix + " " + this.baseurl + "]";
	},
});


const ExpandNaturalLanguageIds = Trigger.extend({
	init: function (bugzillas) {
		this.__init(/\b(?:(\w+)\s+)?bug\s+#?(\d+)\b/ig);
		this._default = null;
		this._bugzillas = {};
		for (let k in bugzillas) {
			if (k === "*") {
				this._default = bugzillas[k];
			} else {
				this._bugzillas[k] = bugzillas[k];
			}
		}
	},

  handleMatch: function (req, match) {
		var bugzilla = null;
		var bugid = null;
		if (match.length == 2) {
			bugzilla = this._bugzillas[match[0]] || this._default;
			bugid = match[1];
		} else {
			bugid = match[0];
			bugzilla = this._default;
		}
		if (this._bugzillas[bugzilla]) {
			req.reply(this._bugzillas[bugzilla] + "/show_bug.cgi?id=" + bugid).again();
		}
	},

	toString: function () {
    return "[bugzilla.ExpandNaturalLanguageIds ...]";
	},
});


exports.configure = function (bot, config) {
	for (let prefix in config) {
		let url = config[prefix];
		if (url.substring(0, 7) === "http://" ||
				url.substring(0, 8) === "https://")
		{
			bot.addTrigger(new ExpandBugId(prefix, url));
			bot.addTrigger(new BugSummary(prefix, url));
		}
	}
	bot.addTrigger(new ExpandNaturalLanguageIds(config));
};
