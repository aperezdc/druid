/* jshint node:true, esnext:true, unused:true */
/*
 * druid-plugin-googlecode.js
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
	init: function (project, prefix) {
		this._project = project;
		if (prefix) {
      this._prefix = prefix + "|" + project;
			prefix = "(?:" + prefix + "|" + project + ")";
		} else {
			this._prefix = prefix = project;
		}
		this.__init(new RegExp("\\b" + prefix + "(?:\\s+bug\\s+|[:# ])(\\d+)\\b", "ig"));
	},

	handleMatch: function (req, match) {
		let url = "https://code.google.com/p/" + this._project + "/issues/detail?id=" + match[0];
		req.reply(url).again();
	},

  toString: function () {
    return "[googlecode.ExpandBugId " + this._prefix + "]";
  },
});


const BugSummary = Trigger.extend({
	init: function (project) {
    this._project = project;
		this._cache = cache({
			max: 500,             // Store 500 elements
			maxAge: 1000 * 60 *3, // ...for a maximum of three minutes
			length: function () { return 1; },
		});
		this.__init(/\bhttps?:\/\/code\.google\.com\/p\/([-\w]+)\/issues\/detail\?id=(\d+)\b/g);
	},

	handleMatch: function (req, match) {
		if (match[0] != this._project)
			return;

    let url = "https://code.google.com/p/" + this._project + "/issues/detail?id=" + match[1];
    if (this._cache.has(url)) {
      req.reply(this._project + ":" + match[1] + " - " + this._cache.get(url)).finish();
      return;
    }

		let self = this;
    req.accept();
    request(url, function (error, response, body) {
      if (error) {
        console.log("[googlecode] error: " + error);
        return;
      }

      let summary = null;
      try {
        summary = cheerio(body).find("div#issueheader span.h3").text();
        if (!summary) {
          summary = "Not found / Invalid bug ID";
				}
      } catch (e) {
        console.log("[googlecode] error: " + e);
      }

      if (summary) {
        self._cache.set(url, summary);
        req.reply(self._project + ":" + match[1] + " - " + summary).finish();
			}
    });
	},

	toString: function () {
    return "[googlecode.BugSummary " + this._project + "]";
  },
});


exports.configure = function (bot, config) {
	for (let project in config) {
		let prefix = config[project];
		if (prefix === true)
			prefix = null;

		bot.addTrigger(new ExpandBugId(project, prefix));
		bot.addTrigger(new BugSummary(project));
	}
};
