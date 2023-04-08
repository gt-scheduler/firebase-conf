import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { FriendInviteData } from "../utils/types";
import sendInvitation from "../utils/nodemailer/sendInvitation";

const firestore = admin.firestore();
const schedulesCollection = firestore.collection("schedules");
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;
const auth = admin.auth();

const corsHandler = cors({ origin: true });

export const createFriendInvitation = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        // To handle fetch and axios
        try {
          request.body = JSON.parse(request.body);
        } catch {
          // return response.status(400).json(apiError("Bad request"));
        }
        const { IDToken, friendEmail, term, version } = request.body;
        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!friendEmail || !term || !version) {
          return response
            .status(400)
            .json(apiError("Invalid arguments provided"));
        }

        console.log("Error 1");

        // Authenticate token id
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        console.log("Error 2");

        const senderEmail = decodedToken.email;
        if (!senderEmail) {
          return response
            .status(400)
            .json(apiError("Cannot invite friend without an email"));
        }

        console.log("Error 3");

        // Check if the user is sending an invite to themself
        if (senderEmail === friendEmail) {
          return response
            .status(400)
            .json(apiError("Cannot invite self to schedule"));
        }

        console.log("Error 4");

        // Get Sender UID from the decoded token
        const senderId = decodedToken.uid;

        // Get Sender record from the schedules collection
        const senderRes = await schedulesCollection.doc(senderId).get();
        const senderData = senderRes.data();

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

        console.log("Error 5");

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

        console.log("Error 6");

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
        };
        let inviteId;
        try {
          const addRes = await invitesCollection.add(record);
          inviteId = addRes.id;
        } catch {
          return response
            .status(400)
            .json(apiError("Error saving new invite record"));
        }

        console.log("Error 7");

        // use nodemailer to send new invite
        try {
          await sendInvitation(
            inviteId,
            senderEmail,
            friendEmail,
            term,
            versionName
          );
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
