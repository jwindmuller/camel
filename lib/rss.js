var Rss     = require('rss');
var Posts   = require('./posts');
var CUtils  = require('./camel_utils');

var utcOffset = 5;
var renderedRss = {};
var renderedAlternateRss = {};

function linkToRemoteSite(article, request) {
    if (typeof(article.metadata.Link) !== 'undefined') {
        return article.metadata.Link;
    }
    return linkToLocalUrl(article, request);
}

function linkToLocalUrl(article, request) {
    return CUtils.externalFilenameForFile(article.file, request);
}

module.exports = {

    respondRss: function(request, response, alternate) {
        var userAgent = request.headers['user-agent'];
        if (userAgent !== undefined && userAgent.has('subscriber')) {
            console.log('RSS: ' + userAgent);
        }
        var url = '/rss';
        var linkGenerator = linkToRemoteSite;
        var savedRss = renderedRss;
        if (alternate) {
            url = '/rss-alternate';
            linkGenerator = linkToLocalUrl;
            savedRss = renderedAlternateRss;
        }
        response.type('application/rss+xml');

        var rssDateSet = savedRss.date !== undefined;
        var cacheValid = rssDateSet && new Date().getTime() - savedRss.date.getTime() <= 3600000;

        if (!cacheValid) {
            this.generateRss(
                request, url,
                function(article) {
                    return linkGenerator(article, request);
                },
                function (rss) {
                    if (alternate) {
                        renderedAlternateRss = rss;
                    } else {
                        renderedRss = rss;
                    }
                    response.status(200).send(rss.rss);
                }
            );
        } else {
            response.status(200).send(savedRss.rss);
        }
    },
    // Generates a RSS feed.
    // The linkGenerator is what determines if the articles will link
    // to this site or to the target of a link post; it takes an article.
    // The completion function takes an object:
    // {
    //   date: // Date the generation happened
    //   rss: // Rendered RSS
    // }
    generateRss: function(request, feedUrl, linkGenerator, completion) {
        var feed = new Rss({
            title      : global.siteMetadata.SiteTitle,
            description: 'Posts to ' + global.siteMetadata.SiteTitle,
            feed_url   : global.siteMetadata.SiteRoot + feedUrl,
            site_url   : global.siteMetadata.SiteRoot,
            image_url  : global.siteMetadata.SiteRoot + '/images/favicon.png',
            author     : 'Your Name',
            copyright  : '2013-' + new Date().getFullYear() + ' Your Name',
            language   : 'en',
            pubDate    : new Date().toString(),
            ttl        : '60'
        });

        var max = 10;
        var i = 0;
        Posts.sortedAndGrouped( function(postsByDay) {
            postsByDay.forEach(function (day) {
                day.articles.forEach(function (article) {
                    if (i < max) {
                        i += 1;
                        feed.item({
                            title: article.metadata.Title,
                            // Offset the time because Heroku's servers are GMT, whereas these dates are EST/EDT.
                            date: new Date(article.metadata.Date).addHours(utcOffset),
                            url: linkGenerator(article),
                            guid: CUtils.externalFilenameForFile(article.file, request),
                            description: article.unwrappedBody.replace(/<script[\s\S]*?<\/script>/gm, "").concat(article.rssFooter)
                        });
                    }
                });
            });

            completion({
                date: new Date(),
                rss: feed.xml()
            });
        });
    }
}