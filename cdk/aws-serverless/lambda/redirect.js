"use strict";

/*
 /m/1234/21/1/Pronosticá+Puebla+vs+América

  /app/Apps/TikTok/UI/MatchResults-Level_Detail;applicationid=20;
    contestid=21;usergroupid=1;matchid=1234;tiktokmode=0
*/

const urlPattern = /^\/m\/(\d+)\/(\d+)\/(\d+)\/.*/i;
const applicationid = 20;
const domainName = "https://tiktok.ligamx.link";

exports.handler = (event, context, callback) => {
  const request = event.Records[0].cf.request;
  const uri = request.uri;

  console.log("Redirect Edge function Start (1.112): ", uri);

  if (urlPattern.test(uri)) {
    console.log("URL pattern matches!", request.uri);
    const matches = uri.match(urlPattern);
    console.log("urlPattern matches:", matches);

    const matchId = matches[1];
    const contestId = matches[2];
    const groupId = matches[3];

    const response = {
      status: "301",
      statusDescription: "Found",
      headers: {
        location: [
          {
            key: "Location",
            value: `${domainName}/app/Apps/TikTok/UI/MatchResults-Level_Detail;applicationid=${applicationid};contestid=${contestId};usergroupid=${groupId};matchid=${matchId};tiktokmode=0`,
          },
        ],
      },
    };
    console.log("Making redirect:" , response);
    callback(null, response);
    return;
  }

  return callback(null, request);
};
