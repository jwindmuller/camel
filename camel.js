/***************************************************
* INITIALIZATION                                  *
***************************************************/

var express    = require('express');
var cookies    = require('cookie-parser')
var compress   = require('compression');
var http       = require('http');
var fs         = require('fs');
var sugar      = require('sugar');
var _          = require('underscore');
var Handlebars = require('handlebars');
var version    = require('./package.json').version;

var Listings   = require('./lib/listings');
var Posts      = require('./lib/posts');
var CUtils     = require('./lib/camel_utils');
var CCache     = CUtils.Cache;
var CamelTweet = require('./lib/tweet');
var CamelRss   = require('./lib/rss');
var Dropbox    = require('./lib/dropbox');

var app = express();
app.use(cookies());
app.use(compress());
app.use(express.static("public"));
app.use(express.static("posts"));
app.use(function (request, response, next) {
	response.header('X-powered-by', 'Camel (https://github.com/cliss/camel)');
	next();
});

/***************************************************
* ROUTES                                          *
***************************************************/

// Pages
app.get('/',           Listings.index.bind(Listings));
app.get('/page/:page', Listings.page.bind(Listings));

app.use('/db', Dropbox);

// RSS
app.get('/rss', function (request, response) {
	CamelRss.respondRss(request, response, false);
});
app.get('/rss-alternate', function (request, response) {
	CamelRss.respondRss(request, response, true);
});

// Archives
app.get(/^\/(\d{4})\/?$/,     Posts.yyyy.bind(Posts));
app.get('/:year/:month',      Posts.yyyyMm.bind(Posts));
app.get('/:year/:month/:day', Posts.yyyyMmDd.bind(Posts));

// Blog Post, such as /2014/3/17/birthday
app.get('/:year/:month/:day/:slug', Posts.single.bind(this));

// Empties the cache.
// app.get('/tosscache', function (request, response) {
//     CCache.empty();
//     response.send(205);
// });

app.get('/count', function (request, response) {
	console.log("/count");
	Posts.sortedAndGrouped(function(all) {
		var count = 0;
		var day;
		var days = 0;
		for (day in _.keys(all)) {
			days += 1;
			count += all[day].articles.length;
		}

		response.send(count + ' articles, across ' + days + ' days that have at least one post.');
	});
});

// Pages, such as /about
app.get('/:slug', Posts.staticPage.bind(this));

/***************************************************
* INITIALIZE                                      *
***************************************************/

global.cacheResetTimeInMillis = 1800000;
global.headerSource = null;
global.footerSource = null;
global.postHeaderTemplate = null;
global.rssFooterTemplate = null;
global.siteMetadata = {};
global.postsRoot = './posts/'
global.metadataMarker = '@@';

(function init() {
	function loadHeaderFooter(file, completion) {
		var templateRoot = './templates/';
		fs.exists(templateRoot + file, function(exists) {
			if (exists) {
				fs.readFile(templateRoot + file, {encoding: 'UTF8'}, function (error, data) {
					if (!error) {
						completion(data);
					}
				});
			}
		});
	}

	loadHeaderFooter('defaultTags.html', function (data) {
		// Note this comes in as a flat string; split on newlines for parsing metadata.
		global.siteMetadata = CUtils.parseMetadata(data.split('\n'));

		// This relies on the above, so nest it.
		loadHeaderFooter('header.html', function (data) {
			global.headerSource = data;
		});
	});
	loadHeaderFooter('footer.html', function (data) {
		global.footerSource = data;
	});
	loadHeaderFooter('rssFooter.html', function (data) {
		global.rssFooterTemplate = Handlebars.compile(data);
	});
	loadHeaderFooter('postHeader.html', function (data) {
		Handlebars.registerHelper('formatPostDate', function (date) {
			return new Handlebars.SafeString(new Date(date).format('{Weekday}, {d} {Month} {yyyy}'));
		});
		Handlebars.registerHelper('formatIsoDate', function (date) {
			return new Handlebars.SafeString(typeof(date) !== 'undefined' ? new Date(date).iso() : '');
		});
		global.postHeaderTemplate = Handlebars.compile(data);
	});

	// Kill the cache every 30 minutes.
	setInterval(function() {
		CCache.empty();
		CamelTweet.tweetLatestPost();
	}, global.cacheResetTimeInMillis);

	CamelTweet.tweetLatestPost();
})();

/***************************************************
* STARTUP                                         *
***************************************************/

var server = http.createServer(app);
var port   = Number(process.env.PORT || 5000);
server.listen(port, function () {
	console.log(
		'Camel v' + version + ' server started on port %s', server.address().port
	);
});
