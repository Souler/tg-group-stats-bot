var fs = require('fs');
var path = require('path');
var util = require('util');
var mongoose = require('mongoose');
var moment = require('moment');
var findOneOrCreate = require('mongoose-find-one-or-create');
var TelegramBot = require('node-telegram-bot-api');
var Strings = require('./strings.js');
var CronJob = require('cron').CronJob;

var f = util.format;

var startBot = function() { // Script entry point
    var token = process.env.TELEGRAM_API_TOKEN;

    if (!token)
        throw new Error('No TELEGRAM_API_TOKEN enviroment variable.');

    connectDatabase();

    global.bot = new TelegramBot(token, {polling: true});
    bot.getMe()
    .then(function (me) {
        console.info('Hi! My name is @%s and I\'m ready to serve', me.username);
        bot.on('message', function (msg) {
            if (!msg || !msg.chat || !msg.from)
                return;

            if (msg.chat.id > 0) // its not a group
                return bot.sendMessage(msg.chat.id, 'Use /stats in a group for seeing me doing stuff!');

            // This should fix the problem with the bot not responding to /sta
            if (msg.text && msg.text.indexOf('@' + me.username) >= 0)
                msg.text = msg.text.replace(new RegExp('@' + me.username, 'gi'), '');

            if (msg.text && msg.text == '/stats')
                sendGroupStats(msg);
            else if (msg.text && msg.text == '/startJob')
                startCronJob(msg);
            else
                updateUserStats(msg);
        });
    });
}

var startCronJob = function(msg) {
    var job = new CronJob({
        cronTime: '00 22 00 * * 1-7',
        onTick: function() {
            bot.sendMessage(msg.chat.id, "This gets fired at 22:00 in GMT+2 every day.");
            // This is a placeholder until I have something figured out to call here.
        },
        start: true,
        timeZone: 'Europe/Amsterdam'
    });

    console.log("[CRON] - Every day at 22:00h GMT+2 - Started.");
    bot.sendMessage(msg.chat.id, "[CRON] - Every day at 22:00h GMT+2 - Started.");
}

var connectDatabase = function() {
    // TODO: Move models to a directory and a file per model
    var UserStatsSchema =  mongoose.Schema({
        user_id: Number,
        group_id: Number,
        username: { type: String, default: null },
        message_count: { type: Number, default: 0 },
        average_message_length: { type: Number, default: null },
        last_message_timestamp: { type: Date, default: 0 },
        average_response_time: { type: Number, default: 0 },
        user_frr: { type: Number, default: 0 }
    });

    UserStatsSchema.index({ user_id: 1, group_id: 1 }, { unique: true });
    UserStatsSchema.plugin(findOneOrCreate);

    var db = mongoose.connect('mongodb://localhost/telegram-stats');
    db.connection.on('error', console.error);
    db.connection.on('open', function() {
        console.info('Correctly connected to database')
    });
    // TODO: Think a proper way to solve this once moved to files
    global.UserStats = db.model('UserStats', UserStatsSchema);
}

var sendGroupStats = function(msg) {
    UserStats
    .find({ group_id: msg.chat.id })
    .sort({ message_count : -1, average_message_length: -1 })
    .then(function (stats) {
        var totalMessages = stats.reduce(function (v,c) { return v+c.message_count }, 0);

        var res = f('Stats for %s by user:\n', msg.chat.title);
        stats.forEach(function(stat) {
            res += f(Strings.USER_MESSAGES_REPORT, stat.username, stat.message_count, stat.average_message_length);
            res += f(Strings.USER_FRIENDSHIP_RATING, stat.user_frr);
            res += f(Strings.AVERAGE_RESPONSE_TIME, stat.average_response_time);
        })
        res += f(Strings.TOTAL_MESSAGES, totalMessages);


        console.info("Sent for stats for %s(%d)", msg.chat.title, msg.chat.id);
        bot.sendMessage(msg.chat.id, res);
    })
}

var updateUserStats = function(msg) {
    var where = { user_id: msg.from.id, group_id: msg.chat.id };

    UserStats
    .findOneOrCreate(where, where, function (err, stats) {
        if (err)
            return console.error(err);

        stats.message_count++;

        updateUserName(msg, stats);
        updateAverageLength(msg, stats);
        updateAverageResponseTime(stats);
        updateFRR(stats);

        console.info('New message by %s(%d) at %s.', stats.username, stats.user_id, msg.chat.title || stats.chat_id);

        stats.save();
    })
}

var updateAverageLength = function(msg, stats) {
    if (msg.text) { // If is a text message, update the avg length of msgs
        if (stats.average_message_length) // An avg. value already exists, update
            stats.average_message_length = Math.ceil((stats.average_message_length + msg.text.length) / 2);
        else
            stats.average_message_length = msg.text.length;
    }
}

var updateAverageResponseTime = function(stats) {
    var rightNow = moment();
    var difference = rightNow.diff(stats.last_message_timestamp, 'seconds')
    stats.last_message_timestamp = rightNow
    stats.average_response_time = Math.ceil((stats.average_response_time + difference) / 2);
}

var updateFRR = function(stats) {
    // Need to make an actual algorithm that makes sense. This is just for testing.
    var friendship = (0.3 * stats.message_count) + (0.7 * stats.average_message_length);
    stats.user_frr = Math.round(friendship * 100) / 100;
}

var updateUserName = function(msg, stats) {
    // Update the username to the most proper one available
    stats.username = msg.from.username || msg.from.first_name || msg.from.id;
}

startBot();
