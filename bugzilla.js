/*
 * bugzilla.js
 * Copyright (C) 2013 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

var request = require("request");
var cheerio = require("cheerio");
var Trigger = require("./druid").Trigger;


var ExpandBugId = Trigger.$extend({
	__init__: function (prefix, baseurl) {
		var self = this;
		self.baseurl = baseurl;
		self.$super(new RegExp("\\b" + prefix + "[:#](\\w+)\\b", "i"), function (req, match) {
			req.reply(self.baseurl + "/show_bug.cgi?id=" + match[0]);
			return true;
		}, true);
	},
});
exports.ExpandBugId = ExpandBugId;


var BugSummary = Trigger.$extend({
	__init__: function (prefix, baseurl) {
		var self = this;
		self.prefix = prefix;
		self.baseurl = baseurl;
		self.$super(/\b(https?:\/\/[\w\.\/:-]+)\/show_bug\.cgi\?id=(\d+)\b/, function (req, match) {
			if (match[0] != self.baseurl) {
				return false;
			}

			var url = self.baseurl + "/show_bug.cgi?id=" + match[1];
			request(url, function (error, response, body) {
				if (error) {
					console.log("[error:bugzilla] " + error);
					return;
				}
				try {
					var $ = cheerio.load(body);
					var summary = $("span#short_desc_nonedit_display").text();
					req.reply("#" + match[1] + " - " + summary);
				} catch (e) {
					console.log("[error:bugzilla] " + e);
				}
			});
			return true;
		}, true);
	},
});
exports.BugSummary = BugSummary;


var ExpandNaturalLanguageIds = Trigger.$extend({
	__init__: function (bugzillas, defaultbz) {
		var self = this;
		self.bugzillas = bugzillas;
		self.defaultbz = defaultbz;
		self.$super(/\b(?:(\w+)\s+)?bug\s+#?(\w+)\b/i, function (req, match) {
			var bugzilla = self.defaultbz;
			var bugid = null;
			if (match.length == 2) {
				bugzilla = match[0];
				bugid = match[1];
			} else {
				bugid = match[0];
			}
			if (self.bugzillas[bugzilla]) {
				var baseurl = self.bugzillas[bugzilla];
				req.reply(baseurl + "/show_bug.cgi?id=" + bugid);
			}
			return true;
		}, true);
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
