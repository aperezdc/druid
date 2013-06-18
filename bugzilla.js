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


exports.configure = function (bot, config) {
	for (var prefix in config) {
		var url = config[prefix];
		bot.addTrigger(new ExpandBugId(prefix, url));
		bot.addTrigger(new BugSummary(prefix, url));
	}
};
