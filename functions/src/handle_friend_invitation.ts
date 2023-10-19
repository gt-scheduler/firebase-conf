import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  FriendInviteData,
  AnyScheduleData,
  FriendData,
  Version3ScheduleData,
} from "../utils/types";

const firestore = admin.firestore();
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

const friendsCollection = firestore.collection(
  "friends"
) as FirebaseFirestore.CollectionReference<FriendData>;

const corsHandler = cors({ origin: true });

/* This endpoint is called when a user clicks on an invitation link - checks if invites are valid and handles accepting them*/
export const handleFriendInvitation = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        try {
          // This request should be made with content type is application/x-www-form-urlencoded.
          // This is done to prevent a pre-flight CORS request made to the firebase function
          // Refer: https://github.com/gt-scheduler/website/pull/187#issuecomment-1496439246
          request.body = JSON.parse(request.body.data);
        } catch {
          response.status(401).json(apiError("Bad request"));
        }
        const { inviteId } = request.body;

        if (!inviteId) {
          return response
            .status(401)
            .json(apiError("Invalid invite id provided"));
        }

        // Get the invite record from the invites collection
        const inviteDoc = await invitesCollection.doc(inviteId).get();

        if (!inviteDoc.exists) {
          return response
            .status(400)
            .json(
              apiError("This link has either expired or has already been used")
            );
        }

        const inviteData = await inviteDoc.data();

        if (!inviteData) {
          return response
            .status(401)
            .json(apiError("Could not find the record for this link"));
        }

        // Get the sender's schedule - it has to be version 3 (an invite was sent from this user)
        const senderSchedule: Version3ScheduleData | undefined = (await (
          await schedulesCollection.doc(inviteData.sender).get()
        ).data()) as Version3ScheduleData | undefined;

        if (!senderSchedule) {
          return response
            .status(400)
            .json(apiError("The sender's account has been deleted"));
        }

        // Check if link hasn't expired by calculating the difference between the current time and the time the link was created
        const diffInDays =
          (new Date().getTime() - inviteData.created.toDate().getTime()) /
          (1000 * 3600 * 24);

        if (diffInDays >= 7) {
          // Delete the invite record and the invite from users shcedule if link is expired
          delete senderSchedule.terms[inviteData.term].versions[
            inviteData.version
          ].friends[inviteData.friend];
          await inviteDoc.ref.delete();
          return response
            .status(400)
            .json(apiError("The invitation link has expired"));
        } else {
          // If the link is not expired, update the sender's schedule in the schedules collection and the friend's record in the friends collection
          senderSchedule.terms[inviteData.term].versions[
            inviteData.version
          ].friends[inviteData.friend].status = "Accepted";

          let friendRecord: FriendData | undefined = await (
            await friendsCollection.doc(inviteData.friend).get()
          ).data();

          // If the friend record doesn't exist, create it
          if (!friendRecord) {
            friendRecord = { terms: {}, info: {} };
            friendRecord.terms[inviteData.term] = { accessibleSchedules: {} };
            friendRecord.terms[inviteData.term].accessibleSchedules[
              inviteData.sender
            ] = [inviteData.version];
          }

          // Update relevant docs
          await friendsCollection.doc(inviteData.friend).set(friendRecord);
          await schedulesCollection.doc(inviteData.sender).set(senderSchedule);
          await inviteDoc.ref.delete();
          return response.status(202).send();
        }
      } catch (err) {
        return response.status(400).json(apiError("Error accepting invite"));
      }
    });
  }
);
