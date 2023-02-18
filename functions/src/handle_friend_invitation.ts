import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { FriendInviteData } from "../utils/types";

const firestore = admin.firestore();
const invitesCollection = firestore.collection("friend-invites-dev") as FirebaseFirestore.CollectionReference<FriendInviteData>;

const corsHandler = cors({ origin: true });

export const handleFriendInvitation = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        const { inviteId } = request.body;
        if (!inviteId) {
          return response.status(401).json(apiError("Invalid invite id provided"));
        }

        await invitesCollection.doc(inviteId).delete();

        // perform further functionality

        return response.status(202).send();
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error deleting invite"));
      }
    });
  }
);
