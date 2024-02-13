import admin from "./firebase";
import {
  AnyScheduleData,
  OldFriendInviteData,
  Version3ScheduleData,
} from "../utils/types";
import * as functions from "firebase-functions";

const firestore = admin.firestore();
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<OldFriendInviteData>;

const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

/*
This function is called every week to clean up the friend-invites collection. We only want to keep the invites made in the past week.
*/

export const cleanInvites = functions.pubsub
  .schedule("every 1 week")
  .onRun(async () => {
    const docs = await invitesCollection.get();
    docs.forEach(async (doc) => {
      const data = await doc.data();
      if (!data) {
        doc.ref.delete();
        return;
      }
      const diffInDays =
        (new Date().getTime() - data.created.toDate().getTime()) /
        (1000 * 3600 * 24);
      if (diffInDays >= 7) {
        const senderDoc = await schedulesCollection.doc(data.sender).get();
        const senderData = (await senderDoc.data()) as
          | Version3ScheduleData
          | undefined;
        if (!senderData) {
          doc.ref.delete();
          return;
        }
        delete senderData.terms[data.term].versions[data.version].friends[
          data.friend
        ];
        await senderDoc.ref.set(senderData);
        doc.ref.delete();
      }
    });
  });
