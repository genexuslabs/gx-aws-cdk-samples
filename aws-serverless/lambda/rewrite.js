"use strict";

const http = require("https");

const indexPage = "index.html";

console.log("Angular Lambda rewrite started v0.1");

exports.handler = async (event, context, callback) => {
  const cf = event.Records[0].cf;
  const request = cf.request;
  const response = cf.response;
  const statusCode = response.status;

  // Only replace 403 and 404 requests typically received
  // when loading a page for a SPA that uses client-side routing
  const doReplace =
    request.method === "GET" && (statusCode == "403" || statusCode == "404");

  const result = doReplace
    ? await generateResponseAndLog(cf, request, indexPage)
    : response;

  callback(null, result);
};

async function generateResponseAndLog(cf, request, indexPage) {
  const domain = cf.config.distributionDomainName;
  const indexPath = `/${indexPage}`;

  const response = await generateResponse(domain, indexPath);

  console.log("response: " + JSON.stringify(response));

  return response;
}

async function generateResponse(domain, path) {
  try {
    // Load HTML index from the CloudFront cache
    const s3Response = await httpGet({ hostname: domain, path: path });

    const headers = s3Response.headers || {
      "content-type": [{ value: "text/html;charset=UTF-8" }],
    };

    return {
      status: "200",
      headers: wrapAndFilterHeaders(headers),
      body: s3Response.body,
    };
  } catch (error) {
    return {
      status: "500",
      headers: {
        "content-type": [{ value: "text/plain" }],
      },
      body: "An error occurred loading the page",
    };
  }
}

function httpGet(params) {
  return new Promise((resolve, reject) => {
    http
      .get(params, (resp) => {
        console.log(
          `Fetching ${params.hostname}${params.path}, status code : ${resp.statusCode}`
        );
        let result = {
          headers: resp.headers,
          body: "",
        };
        resp.on("data", (chunk) => {
          result.body += chunk;
        });
        resp.on("end", () => {
          resolve(result);
        });
      })
      .on("error", (err) => {
        console.log(
          `Couldn't fetch ${params.hostname}${params.path} : ${err.message}`
        );
        reject(err, null);
      });
  });
}

// Cloudfront requires header values to be wrapped in an array
function wrapAndFilterHeaders(headers) {
  const allowedHeaders = [
    "content-type",
    "content-length",
    "last-modified",
    "date",
    "etag",
  ];

  const responseHeaders = {};

  if (!headers) {
    return responseHeaders;
  }

  for (var propName in headers) {
    // only include allowed headers
    if (allowedHeaders.includes(propName.toLowerCase())) {
      var header = headers[propName];

      if (Array.isArray(header)) {
        // assume already 'wrapped' format
        responseHeaders[propName] = header;
      } else {
        // fix to required format
        responseHeaders[propName] = [{ value: header }];
      }
    }
  }

  return responseHeaders;
}
