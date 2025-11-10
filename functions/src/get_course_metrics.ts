import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { SubmitMetricsRequestData } from "../utils/types";

const firestore = admin.firestore();

const corsHandler = cors({ origin: true });

export const getCourseMetrics = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
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

        const difficulties: number[] = [];
        const overalls: number[] = [];
        const workloads: number[] = [];

        const metrics = await firestore.collection("metrics").get();
        console.log(metrics);
        for (const doc of metrics.docs) {
          const data = doc.data() as SubmitMetricsRequestData;

          if (data.metricName === "difficulty" && data.targets.some(t => t.type === "course" && t.reference === courseID)) {
            difficulties.push(...data.values);
          } else if (data.metricName === "overall" && data.targets.some(t => t.type === "course" && t.reference === courseID)) {
            overalls.push(...data.values);
          } else if (data.metricName === "workload" && data.targets.some(t => t.type === "course" && t.reference === courseID)) {
            workloads.push(...data.values);
          }
        }
        
        return response.status(200).json({
          courseID,
          difficulties,
          overalls,
          workloads,
        });
      } catch (err) {
        console.log(err);
        return response.status(500).json(apiError("Internal server error"));
      }
    });
  });
