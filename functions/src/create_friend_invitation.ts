import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  AnyScheduleData,
  FriendInviteData,
  Version3ScheduleData,
} from "../utils/types";
import sendInvitation from "../utils/nodemailer/sendInvitation";

const firestore = admin.firestore();
const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;
const auth = admin.auth();

const corsHandler = cors({ origin: true });

/* This endpoint is called when a user wants to send an invitation*/
export const createFriendInvitation = functions.https.onRequest(
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
        const { IDToken, friendEmail, term, version, redirectURL } =
          request.body;

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!friendEmail || !term || !version) {
          return response
            .status(400)
            .json(apiError("Invalid arguments provided"));
        }

        // Authenticate token id
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        const senderEmail = decodedToken.email;

        if (!senderEmail) {
          return response
            .status(400)
            .json(apiError("Cannot invite friend without an email"));
        }

        // Check if the user is sending an invite to themself
        if (senderEmail === friendEmail) {
          return response
            .status(400)
            .json(apiError("Cannot invite self to schedule"));
        }

        // Get Sender UID from the decoded token
        const senderId = decodedToken.uid;

        // Get Sender record from the schedules collection - it has to be version 3 because an invite was sent from it
        const senderRes = await schedulesCollection.doc(senderId).get();
        const senderData: Version3ScheduleData | undefined =
          senderRes.data() as Version3ScheduleData | undefined;

        if (
          !senderData ||
          !senderData?.terms ||
          !senderData.terms[term]?.versions ||
          !senderData.terms[term].versions[version]
        ) {
          return response
            .status(400)
            .json(apiError("Cannot invite friend to invalid schedule version"));
        }

        const versionName = senderData.terms[term].versions[version].name;

        // Get friend UID if exists from friendEmail
        let friendId;
        try {
          const friendData = await auth.getUserByEmail(friendEmail);
          friendId = friendData.uid;
        } catch {
          return response
            .status(400)
            .json(apiError("Email does not exist in database"));
        }

        // find and delete existing invites for the same sender, friend, term, and version
        const existingInvites = await invitesCollection
          .where("sender", "==", senderId)
          .where("friend", "==", friendId)
          .where("term", "==", term)
          .where("version", "==", version)
          .get();
        const batch = firestore.batch();
        existingInvites.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();

        // create new invite record in db
        const record: FriendInviteData = {
          sender: senderId,
          friend: friendId,
          term,
          version,
          created: admin.firestore.Timestamp.fromDate(new Date()),
        };
        let inviteId;
        try {
          // Add the invite data to the schedule of the sender
          const addRes = await invitesCollection.add(record);
          if (!senderData.terms[term].versions[version].friends) {
            senderData.terms[term].versions[version].friends = {};
          }
          senderData.terms[term].versions[version].friends[friendId] = {
            email: friendEmail,
            status: "Pending",
          };
          schedulesCollection.doc(senderId).set(senderData);
          inviteId = addRes.id;
        } catch {
          return response
            .status(400)
            .json(apiError("Error saving new invite record"));
        }

        // use nodemailer to send new invite
        try {
          await sendInvitation({
            inviteId,
            senderEmail,
            friendEmail,
            term,
            versionName,
            url: redirectURL.replace(/\/+$/, ""),
          });
        } catch {
          return response
            .status(400)
            .json(apiError("Error sending invite email"));
        }

        return response.status(200).json({ inviteId });
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  }
);
