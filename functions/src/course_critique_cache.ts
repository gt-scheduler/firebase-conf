import * as functions from "firebase-functions";
import * as date from "date-and-time";
import * as fetch from "node-fetch";
import * as zlib from "zlib";
import * as util from "util";
import { Response } from "express";
import admin from "./firebase";
import * as cors from "cors";
import { apiError } from "./api";

const compress = util.promisify(zlib.brotliCompress);
const decompress = util.promisify(zlib.brotliDecompress);

const UPSTREAM_COURSE_DATA_URL =
  "https://c4citk6s9k.execute-api.us-east-1.amazonaws.com/prod/data/course";

// Cache error responses for 1 hour
const CACHE_ERROR_RESPONSE_EXPIRATION_SECONDS = 60 * 60 * 1;
// Cache course data for 6 hours
const CACHE_SUCCESS_RESPONSE_EXPIRATION_SECONDS = 60 * 60 * 6;

const courseDataCacheCollection = admin
  .firestore()
  .collection(
    "course_critique_course_data_cache"
  ) as FirebaseFirestore.CollectionReference<CacheItem>;

type CacheItem = {
  // ISO 8601 date-time that the item was added
  t: string;
  // Schema version
  // (old versions are ignored)
  v: 1;
  // Opaque Course Critique API response string,
  // brotli-compressed before being stored
  d: string;
  // Opaque Course Critique API status code
  s: number;
  // The content-type of the response string
  c: string;
};

// Right now, this always allows the requesting origin.
// Nothing sensitive is served from this function,
// so this is fine to use.
// Not restricting the origin to gt-scheduler.org
// makes it easier to develop locally by using the same API endpoint.
const corsHandler = cors({ origin: true });

export const getCourseDataFromCourseCritique = functions.https.onRequest(
  (request, response) =>
    corsHandler(request, response, async () => {
      // Get the course ID from the request
      const courseID = request.query["courseID"];
      if (courseID == null || courseID.length === 0) {
        response
          .status(400)
          .json(apiError("request missing 'courseID' query parameter"));
        return;
      } else if (typeof courseID !== "string") {
        response
          .status(400)
          .json(
            apiError(
              "request should contain a single 'courseID' query parameter"
            )
          );
        return;
      } else if (courseID.length > 16) {
        // No valid course IDs are longer than 16 characters
        // (just place some upper limit on them).
        response
          .status(400)
          .json(
            apiError(
              "'courseID' query parameter is too long (must be <= 16 characters)"
            )
          );
        return;
      }

      // Check to see if the course has a cached value in Firestore
      let maybeStaleCache: CacheItem | null = null;
      const document = await courseDataCacheCollection.doc(courseID).get();
      if (document.exists) {
        const data = document.data();
        if (data != null) {
          // Use a different expiration if the cached response is an error
          let expirationSeconds: number;
          if (data.s >= 400) {
            expirationSeconds = CACHE_ERROR_RESPONSE_EXPIRATION_SECONDS;
          } else {
            expirationSeconds = CACHE_SUCCESS_RESPONSE_EXPIRATION_SECONDS;
          }

          // See if the document's addition time is fresh enough
          const now = new Date();
          const expiredAt = date.addSeconds(now, expirationSeconds);
          const timestamp = new Date(data.t);
          if (timestamp < expiredAt) {
            await sendCachedResponse(courseID, response, data);
            return;
          }

          // Store the data to use in case there is an error contacting upstream
          maybeStaleCache = data;
        }
      }

      // Fetch the upstream data
      const encodedCourseID = encodeURIComponent(courseID);
      const url = `${UPSTREAM_COURSE_DATA_URL}?courseID=${encodedCourseID}`;
      let upstreamResponse: fetch.Response;
      let upstreamResponseBody: string;
      try {
        upstreamResponse = await fetch.default(url, {
          method: "GET",
          headers: { "User-Agent": "gt-scheduler-cache-proxy (node-fetch)" },
        });
        upstreamResponseBody = await upstreamResponse.text();
      } catch (err) {
        // There was an error contacting the upstream API
        // (this is not a 3xx-5xx response code).
        // Log the error
        functions.logger.error(
          `An error occurred while making a request to Course Critique: ${err}`,
          { url }
        );

        // If there is cached data (even if stale), return it.
        if (maybeStaleCache !== null) {
          await sendCachedResponse(courseID, response, maybeStaleCache);
          return;
        }

        // Otherwise, return a 504 (Gateway Timeout)
        response
          .status(504)
          .json(apiError("could not contact upstream Course Critique API"));
        return;
      }

      // Store the timestamp, data, and status code in Firestore
      const timestamp = new Date().toISOString();
      const contentType =
        upstreamResponse.headers.get("content-type") ?? "application/json";
      const writePromise = storeCacheItem(courseID, upstreamResponseBody, {
        v: 1,
        t: timestamp,
        s: upstreamResponse.status,
        c: contentType,
      });

      functions.logger.info("Loaded cache with fresh data for course", {
        course_id: courseID,
      });

      // Eagerly send the response before waiting for the write to complete
      response
        .status(upstreamResponse.status)
        .header("Content-Type", contentType)
        .header("Age", "0")
        .send(upstreamResponseBody);

      await writePromise;
    })
);

async function sendCachedResponse(
  courseID: string,
  response: Response,
  item: CacheItem
) {
  const uncompressedBody = await decompress(Buffer.from(item.d, "base64"));
  const now = new Date();
  const age = Math.max(0, date.subtract(now, new Date(item.t)).toSeconds());
  response
    .status(item.s)
    .header("Content-Type", item.c)
    .header("Age", String(Math.floor(age)))
    .send(uncompressedBody);

  functions.logger.info("Using cached data for course", {
    course_id: courseID,
    age,
  });
}

async function storeCacheItem(
  courseID: string,
  rawBody: string,
  item: Omit<CacheItem, "d">
): Promise<void> {
  const compressedBody = (await compress(rawBody)).toString("base64");
  const newDocument: CacheItem = {
    ...item,
    d: compressedBody.toString(),
  };

  await courseDataCacheCollection.doc(courseID).set(newDocument);
}
