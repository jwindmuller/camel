/***************************************************
* INITIALIZATION                                  *
***************************************************/

var express = require('express');
var compress = require('compression');
var http = require('http');
var fs = require('fs');
var sugar = require('sugar');
var _ = require('underscore');

var Handlebars = require('handlebars');
var version = require('./package.json').version;

var app = express();
app.use(compress());
app.use(express.static("public"));
app.use(express.static("posts"));
app.use(function (request, response, next) {
	response.header('X-powered-by', 'Camel (https://github.com/cliss/camel)');
	next();
});
var server = http.createServer(app);

// "Statics"
var postsRoot = './posts/';
var templateRoot = './templates/';
var metadataMarker = '@@';

var footnoteAnchorRegex = /[#"]fn\d+/g;
var footnoteIdRegex = /fnref\d+/g;
var cacheResetTimeInMillis = 1800000;

global.headerSource;
global.footerSource = null;
global.postHeaderTemplate = null;
global.rssFooterTemplate = null;
global.siteMetadata = {};

var Posts = require('./lib/posts');
var CUtils  = require('./lib/camel_utils');
var CCache  = CUtils.Cache;
var CamelTweet = require('./lib/tweet');
var CamelRss = require('./lib/rss');

/***************************************************
* HELPER METHODS                                  *
***************************************************/


function loadHeaderFooter(file, completion) {
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

function init() {
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
	}, cacheResetTimeInMillis);

	CamelTweet.tweetLatestPost();
}

/***************************************************
* ROUTE HELPERS                                   *
***************************************************/


// Handles a route by trying the cache first.
// file: file to try.
// sender: function to send result to the client. Only parameter is an object that has the key 'body', which is raw HTML
// generator: function to generate the raw HTML. Only parameter is a function that takes a completion handler that takes the raw HTML as its parameter.
// baseRouteHandler() --> generator() to build HTML --> completion() to add to cache and send
function baseRouteHandler(file, sender, generator) {
	if (CCache.getRenderedPost(file) === null) {
		console.log('Not in cache: ' + file);
		generator(function (postData) {
			CCache.setRenderedPost(file, {body: postData});
			sender({body: postData});
		});
	} else {
		console.log('In cache: ' + file);
		sender(CCache.getRenderedPost(file));
	}
}



function homepageBuilder(page, completion, redirect) {
	var indexInfo = CUtils.generateHtmlAndMetadataForFile(postsRoot + 'index.md');
	var footnoteIndex = 0;

	Handlebars.registerHelper('formatDate', function (date) {
		return new Handlebars.SafeString(new Date(date).format('{Weekday}<br />{d}<br />{Month}<br />{yyyy}'));
	});
	Handlebars.registerHelper('dateLink', function (date) {
		var parsedDate = new Date(date);
		return '/' + parsedDate.format("{yyyy}") + '/' + parsedDate.format("{M}") + '/' + parsedDate.format('{d}') + '/';
	});
	Handlebars.registerHelper('offsetFootnotes', function (html) {
		// Each day will call this helper once. We will offset the footnotes
		// to account for multiple days being on one page. This will avoid
		// conflicts with footnote numbers. If two days both have footnote,
		// they would both be "fn1". Which doesn't work; they need to be unique.
		var retVal = html.replace(footnoteAnchorRegex, '$&' + footnoteIndex);
		retVal = retVal.replace(footnoteIdRegex, '$&' + footnoteIndex);
		footnoteIndex += 1;

		return retVal;
	});
	Handlebars.registerPartial('article', indexInfo.metadata.ArticlePartial);
	var dayTemplate = Handlebars.compile(indexInfo.metadata.DayTemplate);
	var footerTemplate = Handlebars.compile(indexInfo.metadata.FooterTemplate);

	var bodyHtml = '';

	Posts.paginated(function (pages) {

		// If we're asking for a page that doesn't exist, redirect.
		if (page < 0 || page > pages.length) {
			redirect(pages.length > 1 ? '/page/' + pages.length : '/');
			return;
		}
		var days = pages[page - 1].days;
		days.forEach(function (day) {
			bodyHtml += dayTemplate(day);
		});

		// If we have more data to display, set up footer links.
		var footerData = {};
		if (page > 1) {
			footerData.prevPage = page - 1;
		}
		if (pages.length > page) {
			footerData.nextPage = page + 1;
		}

		var fileData = CUtils.generateHtmlAndMetadataForFile(postsRoot + 'index.md');
		var metadata = fileData.metadata;
		var header = fileData.header;
		// Replace <title>...</title> with one-off for homepage, because it doesn't show both Page & Site titles.
		var titleBegin = header.indexOf('<title>') + "<title>".length;
		var titleEnd = header.indexOf('</title>');
		header = header.substring(0, titleBegin) + metadata.SiteTitle + header.substring(titleEnd);
		// Carry on with body
		bodyHtml = CUtils.replaceMetadata(metadata, bodyHtml);
		var fullHtml = header + bodyHtml + footerTemplate(footerData) + global.footerSource;
		completion(fullHtml);
	});
}


/***************************************************
* ROUTES                                          *
***************************************************/

app.get('/', function (request, response) {
    // Determine which page we're on, and make that the filename
    // so we cache by paginated page.
    var page = 1;
    if (typeof(request.query.p) !== 'undefined') {
        page = Number(request.query.p);
        if (isNaN(page)) {
            response.redirect('/');
            return;
        } else {
        	response.redirect('/page/' + page);
        	return;
        }
    }

    respondWithPage(1, response);
});

app.get('/page/:page', function (request, response) {
	var page = Number(request.params.page);
	if (isNaN(page)) {
		response.redirect('/');
		return;
	}

	respondWithPage(page, response);
});


function respondWithPage(page, response) {
	// Do the standard route handler. Cough up a cached page if possible.
    baseRouteHandler('/page/' + page,
    	function (cachedData) {
        	response.status(200).send(cachedData.body);
    	},
    	function (completion) {
        	homepageBuilder(page, completion, function (destination) {
        		response.redirect(destination);
        	});
    	}
    );
}

app.get('/rss', function (request, response) {
	CamelRss.respondRss(request, response, false);
});

app.get('/rss-alternate', function (request, response) {
	CamelRss.respondRss(request, response, true);
});

app.get(/^\/(\d{4})\/?$/,     Posts.yyyy.bind(Posts));
app.get('/:year/:month',      Posts.yyyyMm.bind(Posts));
app.get('/:year/:month/:day', Posts.yyyyMmDd.bind(Posts));

// Get a blog post, such as /2014/3/17/birthday
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

// Support for non-blog posts, such as /about
app.get('/:slug', Posts.staticPage.bind(this));

/***************************************************
* STARTUP                                         *
***************************************************/
init();
var port = Number(process.env.PORT || 5000);
server.listen(port, function () {
console.log('Camel v' + version + ' server started on port %s', server.address().port);
});
