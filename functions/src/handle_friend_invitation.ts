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

const auth = admin.auth();
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
        const { inviteId, token } = request.body;

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

        const inviteData: FriendInviteData | undefined = inviteDoc.data();

        if (!inviteData) {
          return response
            .status(401)
            .json(apiError("Could not find the record for this link"));
        }

        // Get the sender's schedule - it has to be version 3 (an invite was sent from this user)
        const senderSchedule: Version3ScheduleData | undefined = (
          await schedulesCollection.doc(inviteData.sender).get()
        ).data() as Version3ScheduleData | undefined;

        if (!senderSchedule) {
          return response
            .status(400)
            .json(apiError("The sender's account has been deleted"));
        }

        // Check if link hasn't expired by calculating the difference between the current time and the time the link was created
        const diffInDays =
          (new Date().getTime() - inviteData.created.toDate().getTime()) /
          (1000 * 3600 * 24);

        const defaultValidDuration = 7;
        const validDuration = inviteData?.validFor
          ? inviteData.validFor / (3600 * 24)
          : defaultValidDuration;
        if (diffInDays >= validDuration) {
          // Check if invite link is for a specific friend
          if (!inviteData.link && inviteData.friend) {
            // Delete the invite record and the invite from users shcedule if single-invite link is expired
            inviteData.versions.forEach(
              (idx) =>
                delete senderSchedule.terms[inviteData.term].versions[idx]
                  .friends[inviteData.friend!]
            );
          }
          await inviteDoc.ref.delete();
          return response
            .status(400)
            .json(apiError("The invitation link has expired"));
        }

        // If the link is not expired, update the sender's schedule in the schedules collection and the friend's record in the friends collection

        let friendToken: admin.auth.DecodedIdToken | undefined = undefined;
        if (inviteData.link && token) {
          try {
            friendToken = await auth.verifyIdToken(token);
          } catch {
            return response.status(401).json(apiError("User not found"));
          }
        }

        const friendId = inviteData.link
          ? friendToken?.uid
          : inviteData?.friend;
        if (!friendId) {
          return response.status(400).json(apiError("Invalid friend ID"));
        }
        if (inviteData.sender === friendId) {
          return response
            .status(400)
            .json(apiError("Cannot invite self to schedule"));
        }
        const friendEmail = (await auth.getUser(friendId)).email;
        if (!friendEmail) {
          return response
            .status(400)
            .json(apiError("Invalid friend email from DB"));
        }
        inviteData.versions.forEach(async (idx) => {
          senderSchedule.terms[inviteData.term].versions[idx].friends[
            friendId
          ] = {
            // email:
            //   senderSchedule.terms[inviteData.term].versions[idx].friends[
            //     friendId
            //   ].email ?? friendEmail,
            email: friendEmail,
            status: "Accepted",
          };
        });

        let friendRecord: FriendData | undefined = (
          await friendsCollection.doc(friendId).get()
        ).data();

        // If the friend record doesn't exist, create it
        if (!friendRecord) {
          friendRecord = { terms: {}, info: {} };
        }
        if (!friendRecord.terms[inviteData.term]) {
          friendRecord.terms[inviteData.term] = { accessibleSchedules: {} };
        }
        const friendArr =
          friendRecord.terms[inviteData.term].accessibleSchedules[
            inviteData.sender
          ] ?? [];
        friendArr.push(...inviteData.versions);

        friendRecord.terms[inviteData.term].accessibleSchedules[
          inviteData.sender
        ] = friendArr;
        if (!(inviteData.sender in friendRecord.info)) {
          const senderEmail =
            (await auth.getUser(inviteData.sender)).email ?? "";
          friendRecord.info[inviteData.sender] = {
            email: senderEmail,
            name: senderEmail,
          };
        }

        // Update relevant docs
        await friendsCollection.doc(friendId).set(friendRecord);
        await schedulesCollection.doc(inviteData.sender).set(senderSchedule);
        await inviteDoc.ref.delete();
        return response.status(202).send();
      } catch (err) {
        return response.status(400).json(apiError("Error accepting invite"));
      }
    });
  }
);
