import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { FriendInviteData, AnyScheduleData, FriendData, Version3ScheduleData } from "../utils/types";

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

export const handleFriendInvitation = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        // To handle fetch and axios
        try {
          request.body = JSON.parse(request.body);
        } catch {
          return response.status(400).json(apiError("Bad request"));
        }
        const { inviteId } = request.body;

        if (!inviteId) {
          return response
            .status(401)
            .json(apiError("Invalid invite id provided"));
        }

        const inviteDoc = await invitesCollection.doc(inviteId).get();
        console.log(inviteDoc);
        if (!inviteDoc.exists) {
          return response
            .status(400)
            .json(
              apiError("This link has either expired or has already been used")
            );
        }

        // Delete the invite regardless of whether it is valid or not
        // await invitesCollection.doc(inviteId).delete();

        const inviteData = await inviteDoc.data();
        console.log(inviteData);
        if (!inviteData) {
          return response
            .status(401)
            .json(apiError("Could not find the record for this link"));
        }

        const senderSchedule: Version3ScheduleData | undefined = await (
          await schedulesCollection.doc(inviteData.sender).get()
        ).data() as Version3ScheduleData | undefined;

        if (!senderSchedule) {
          return response
            .status(400)
            .json(apiError("The sender's account has been deleted"));
        }

        // Check if link hasn't expired
        const diffInDays =
          (new Date().getTime() - inviteData.created.toDate().getTime()) /
          (1000 * 3600 * 24);

        if (diffInDays >= 7) {
          delete senderSchedule.terms[inviteData.term].versions[
            inviteData.version
          ].friends[inviteData.friend];
          await inviteDoc.ref.delete();
          return response
            .status(400)
            .json(apiError("The invitation link has expired"));
        } else {
          senderSchedule.terms[inviteData.term].versions[
            inviteData.version
          ].friends[inviteData.friend].status = "Accepted";

          let friendRecord: FriendData | undefined = await (
            await friendsCollection.doc(inviteData.friend).get()
          ).data();
          if (!friendRecord) {
            friendRecord = { terms: {} };
            friendRecord.terms[inviteData.term] = { accessibleSchedules: {} };
            friendRecord.terms[inviteData.term].accessibleSchedules[
              inviteData.sender
            ] = [inviteData.version];
          }
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
