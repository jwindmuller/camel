var Twitter = require('twitter');
var twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_TOKEN_SECRET
});

var twitterClientNeedle = 'Camel Spitter';
var twitterUsername = 'caseylisscom';

module.exports = {
    tweetLatestPost: function() {
        if (twitterClient !== null && typeof(process.env.TWITTER_CONSUMER_KEY) !== 'undefined') {
            twitterClient.get('statuses/user_timeline', {screen_name: twitterUsername}, function (error, tweets) {
                if (error) {
                    console.log(JSON.stringify(error, undefined, 2));
                    return;
                }

                var lastUrl = null, i = 0;
                while (lastUrl === null && i < tweets.length) {
                    if (tweets[i].source.has(twitterClientNeedle) &&
                        tweets[i].entities &&
                        tweets[i].entities.urls) {
                        lastUrl = tweets[i].entities.urls[0].expanded_url;
                    } else {
                        i += 1;
                    }
                }

                Posts.sortedAndGrouped(function (postsByDay) {
                    var latestPost = postsByDay[0].articles[0];
                    var link = latestPost.metadata.SiteRoot + latestPost.metadata.relativeLink;

                    if (lastUrl !== link) {
                        console.log('Tweeting new link: ' + link);

                        // Figure out how many characters we have to play with.
                        twitterClient.get('help/configuration', null, function (error, configuration) {
                            var suffix = " \n\n";
                            var maxSize = 140 - configuration.short_url_length_https - suffix.length;

                            // Shorten the title if need be.
                            var title = latestPost.metadata.Title;
                            if (title.length > maxSize) {
                                title = title.substring(0, maxSize - 3) + '...';
                            }

                            var params = {
                                status: title + suffix + link
                            };
                            twitterClient.post('statuses/update', params, function (error, tweet, response) {
                                    if (error) {
                                        console.log(JSON.stringify(error, undefined, 2));
                                    }
                            });
                        });
                    } else {
                        console.log('Twitter is up to date.');
                    }
                });
            });
        }
    }
}