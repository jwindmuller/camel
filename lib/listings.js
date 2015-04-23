var Handlebars = require('handlebars');
var CUtils     = require('./camel_utils');
var Posts      = require('./posts');

var footnoteAnchorRegex = /[#"]fn\d+/g;
var footnoteIdRegex     = /fnref\d+/g;
var postsRoot = './posts/';

module.exports = {
    index: function (request, response) {
        redirectToPageInQuery(request.query.p)

        respondWithPage(1, response);
    },
    page: function (request, response) {
        var page = Number(request.params.page);
        if (isNaN(page)) {
            response.redirect('/');
        } else {
            respondWithPage(page, response);
        }
    }
};

function redirectToPageInQuery(p) {
    if (p === undefined) {
        return;
    }
    if (isNaN(p)) {
        response.redirect('/');
    } else {
        response.redirect('/page/' + p);
    }
}


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

// Handles a route by trying the cache first.
// file: file to try.
// sender: function to send result to the client. Only parameter is an object that has the key 'body', which is raw HTML
// generator: function to generate the raw HTML. Only parameter is a function that takes a completion handler that takes the raw HTML as its parameter.
// baseRouteHandler() --> generator() to build HTML --> completion() to add to cache and send
function baseRouteHandler(file, sender, generator) {
    if (CUtils.Cache.getRenderedPost(file) === null) {
        console.log('Not in cache: ' + file);
        generator(function (postData) {
            CUtils.Cache.setRenderedPost(file, {body: postData});
            sender({body: postData});
        });
    } else {
        console.log('In cache: ' + file);
        sender(CUtils.Cache.getRenderedPost(file));
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