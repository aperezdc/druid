/*
 * googlecode.js
 * Copyright (C) 2013 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

var cache = require("lru-cache");
var request = require("request");
var cheerio = require("cheerio");
var Trigger = require("./druid").Trigger;


var ExpandBugId = Trigger.$extend({
	__init__: function (project, prefix) {
		var self = this;
		if (prefix) {
			prefix = "(?:" + prefix + "|" + project + ")";
		} else {
			prefix = project;
		}
		self.$super(new RegExp("\\b" + prefix + "(?:\\s+bug\\s+|[:# ])(\\d+)\\b", "i"), function (req, match) {
			req.reply("https://code.google.com/p/" + project + "/issues/detail?id=" + match[0]).end();
			return true;
		});
	},
});
exports.ExpandBugId = ExpandBugId;


var BugSummary = Trigger.$extend({
	__init__: function (project) {
		var self = this;
		self._cache = cache({
			max: 500,             // Store 500 elements
			maxAge: 1000 * 60 *3, // ...for a maximum of three minutes
			length: function (n) { return 1; },
		});
		self.$super(/\bhttps?:\/\/code\.google\.com\/p\/([-\w]+)\/issues\/detail\?id=(\d+)\b/, function (req, match) {
			if (match[0] != project) {
				return false;
			}

			var url = "https://code.google.com/p/" + project + "/issues/detail?id=" + match[1];
			if (self._cache.has(url)) {
				req.reply(project + ":" + match[1] + " - " + self._cache.get(url)).end();
				return true;
			}

			req.replyLater();
			request(url, function (error, response, body) {
				if (error) {
					console.log("googlecode: error: " + error);
					return;
				}
				try {
					var summary = cheerio(body).find("div#issueheader span.h3").text();
					if (!summary) {
						summary = "Not found / Invalid bug ID";
					}
					self._cache.set(url, summary);
					req.reply(project + ":" + match[1] + " - " + summary).end();
				} catch (e) {
					console.log("googlecode: error: " + e);
				}
			});
			return true;
		});
	},
});
exports.BugSummary = BugSummary;


exports.configure = function (bot, config) {
	for (var project in config) {
		var prefix = config[project];
		if (prefix === true) {
			prefix = null;
		}
		bot.addTrigger(new ExpandBugId(project, prefix));
		bot.addTrigger(new BugSummary(project));
	}
};
