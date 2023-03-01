import admin from "./firebase";
import { FriendInviteData } from "../utils/types";
import * as functions from "firebase-functions";

const firestore = admin.firestore();
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

/*
This function is called every week to clean up the friend-invites collection. We only want to keep the invites made in the past week.
*/

export const cleanInvites = functions.pubsub
  .schedule("every 1 week")
  .onRun(async () => {
    const docs = await invitesCollection.listDocuments();
    docs.forEach(async (doc) => {
      const data = await (await doc.get()).data();
      if (!data) {
        doc.delete();
        return;
      }
      const diffInDays =
        (new Date().getTime() - data.created.toDate().getTime()) /
        (1000 * 3600 * 24);
      if (diffInDays >= 7) {
        doc.delete();
      }
    });
  });
