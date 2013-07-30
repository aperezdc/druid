/*
 * bugzilla.js
 * Copyright (C) 2013 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

var cache = require("lru-cache");
var request = require("request");
var cheerio = require("cheerio");
var Trigger = require("./druid").Trigger;


var ExpandBugId = Trigger.$extend({
	__init__: function (prefix, baseurl) {
		var self = this;
		self.baseurl = baseurl;
		self.$super(new RegExp("\\b" + prefix + "(?:\\s+bug\\s+)[:# ](\\d+)\\b", "ig"), function (req, match) {
			req.reply(self.baseurl + "/show_bug.cgi?id=" + match[0]).end();
			return true;
		});
	},
});
exports.ExpandBugId = ExpandBugId;


var BugSummary = Trigger.$extend({
	__init__: function (prefix, baseurl) {
		var self = this;
		self._cache = cache({
			max: 500,              // Store 500 elements
			maxAge: 1000 * 60 * 3, // ...for a maximum of three minutes
			length: function (n) { return 1; },
		});
		self.prefix = prefix;
		self.baseurl = baseurl;
		self.$super(/\b(https?:\/\/[\w\.\/:-]+)\/show_bug\.cgi\?id=(\d+)\b/g, function (req, match) {
			if (match[0] != self.baseurl) {
				return false;
			}

			var url = self.baseurl + "/show_bug.cgi?id=" + match[1];
			if (self._cache.has(url)) {
				req.reply("#" + match[1] + " - " + self._cache.get(url)).end();
				return true;
			}

			req.replyLater();
			request(url, function (error, response, body) {
				if (error) {
					console.log("bugzilla: error: " + error);
					return;
				}
				try {
					var summary = cheerio(body).find("span#short_desc_nonedit_display").text();
					if (!summary) {
						summary = "Not found / Invalid bug ID";
					}
					self._cache.set(url, summary);
					req.reply("#" + match[1] + " - " + summary).end();
				} catch (e) {
					console.log("bugzilla: error: " + e);
				}
			});
			return true;
		});
	},
});
exports.BugSummary = BugSummary;


var ExpandNaturalLanguageIds = Trigger.$extend({
	__init__: function (bugzillas, defaultbz) {
		var self = this;
		self.bugzillas = bugzillas;
		self.defaultbz = defaultbz;
		self.$super(/\b(?:(\w+)\s+)?bug\s+#?(\d+)\b/ig, function (req, match) {
			var bugzilla = self.defaultbz;
			var bugid = null;
			if (match.length == 2) {
				bugzilla = match[0];
				bugid = match[1];
			} else {
				bugid = match[0];
			}
			if (!self.bugzillas[bugzilla]) {
				bugzilla = self.defaultbz;
			}
			if (self.bugzillas[bugzilla]) {
				var baseurl = self.bugzillas[bugzilla];
				req.reply(baseurl + "/show_bug.cgi?id=" + bugid).end();
			}
			return true;
		});
	},
});
exports.ExpandNaturalLanguageIds = ExpandNaturalLanguageIds;


exports.configure = function (bot, config, mapping, deflt) {
	for (var prefix in config) {
		var url = config[prefix];
		bot.addTrigger(new ExpandBugId(prefix, url));
		bot.addTrigger(new BugSummary(prefix, url));
	}
	if (mapping && deflt) {
		bot.addTrigger(new ExpandNaturalLanguageIds(mapping, deflt));
	}
};
