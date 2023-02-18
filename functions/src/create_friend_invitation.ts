import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { FriendInviteData } from "../utils/types";
import sendInvitation from "../utils/nodemailer/sendInvitation";

const firestore = admin.firestore();
const schedulesCollection = firestore.collection("schedules-dev");
const invitesCollection = firestore.collection("friend-invites-dev") as FirebaseFirestore.CollectionReference<FriendInviteData>;
const auth = admin.auth();

const corsHandler = cors({ origin: true });

export const createFriendInvitation = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        const { IDToken, friendEmail, term, version } = JSON.parse(request.body);
        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!friendEmail || !term || !version) {
          return response.status(400).json(apiError("Invalid arguments provided"));
        }

        // Authenticate token id
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        const senderEmail = decodedToken.email;
        // Check if the user is sending an invite to themself
        if (senderEmail === friendEmail) {
          return response.status(400).json(apiError("Cannot invite self to schedule"));
        }

        // Get Sender UID and email from the decoded token
        const senderId = decodedToken.uid;
        // const senderEmail = decodedToken.email;
        const senderData = await schedulesCollection
          .doc(senderId)
          .get()
          .then((doc) => {
            return doc.data();
          });

        if (!senderData || !senderData?.terms || !senderData.terms[term]?.versions || !senderData.terms[term].versions[version]) {
          return response.status(400).json(apiError("Cannot invite friend to invalid schedule version"));
        }

        const versionName = senderData.terms[term].versions[version].name;

        // Get friend UID if exists from friendEmail
        let friendId
        try {
          const friendData = await auth.getUserByEmail(friendEmail);
          friendId = friendData.uid;
        } catch {
          return response.status(400).json(apiError("Email does not exist in database"));
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
        };
        let inviteId;
        try {
          const addRes = await invitesCollection.add(record);
          inviteId = addRes.id;
        } catch {
          return response.status(400).json(apiError("Error saving new invite record"));
        }
        
        // use nodemailer to send new invite
        await sendInvitation(inviteId, senderEmail, friendEmail, term, versionName);

        return response.status(200).json({inviteId});
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  }
);