/* jshint node:true, esnext:true, unused:true */
/*
 * druid.js
 * Copyright (C) 2014 Adrian Perez <aperez@igalia.com>
 *
 * Distributed under terms of the MIT license.
 */

"use strict";

const common = require("./druid-common");

exports.Error = common.Error;
exports.Trigger = common.Trigger;
exports.Command = common.Command;
exports.Bot = common.Bot;

exports.xmpp = require("./druid-xmpp");
exports.irc = require("./druid-irc");

