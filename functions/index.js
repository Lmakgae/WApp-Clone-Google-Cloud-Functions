const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const firestore = admin.firestore();

/* 
    When a new account is created
*/
exports.newAccountCreation = functions.auth
    .user()
    .onCreate((user, context) => {
        //Firestore document referrences
        const userAccountRef = firestore.doc(`users/${user.uid}`);

        admin.auth().updateUser(user.uid, {})

        var userAccount = {
            phone_number:user.phoneNumber,
            uid: user.uid,
        };
        
        return userAccountRef.set(userAccount, {merge: true})
            .then((onFulfilled) =>{
                console.log('User account data written to database: ID: '+ user.uid);

            })
            .catch((onRejected) => {
                console.log('User account data failed to be written to database. ID: ' + user.uid + ". Reason: " + onRejected);
            })

})

/* 
    Updating the public user account when the user updates their profile
*/
exports.updatePublicUserProfile = functions.firestore
    .document('users/{userID}')
    .onUpdate((change, context) => {

        const document = change.after.exists ? change.after.data() : null;

        if (document != null) {
            var publicUserProfile = {
                name: document.name,
                number: document.phone_number,
                profile_photo_path: document.profile_photo_path,
                profile_photo_url: document.profile_photo_url,
                device_instance_id: document.device_instance_id,
                server_id: document.uid,
                status: document.status,
                status_timestamp: document.status_timestamp
            };

            const publicUserAccountRef = firestore.doc(`public_profile/${document.phone_number}`);

            return publicUserAccountRef.set(publicUserProfile, {merge: true})
                .then((onFulfilled) => {
                    console.log('Public user account data updated on the database: ID: '+ document.uid);
                })
                .catch((onRejected) => {
                    console.log('Public user account data failed to be updated to database. ID: ' + document.uid + ". Reason: " + onRejected);
                })

        } else {
            console.log('Public user account data failed to be written/updated to database. User might be deleted');
            return null;
        }

});


/* 
    On creation of a new message
*/
exports.onCreateMessage = functions.firestore
    .document('chat_conversations/{chatConversationId}/messages/{messageId}')
    .onCreate((snap, context) => {

        const newMessageReceived = 'NEW_MESSAGE_RECEIVED';
        const newMessageSent = 'NEW_MESSAGE_SENT';

        const message = snap.data();
        const receiver = message.receiver;
        const sender = message.sender;

        const ReceiverDeviceToken = admin.firestore().collection('users').where('phone_number', '==', receiver).get();
        const SenderDeviceToken = admin.firestore().collection('users').where('phone_number', '==', sender).get();

        let ReceiverSnapshotData;
        let ReceiverToken;
        let ReceiverUID;
        let SenderSnapshotData;
        let SenderToken;
        let SenderUID;

        return Promise.all([ReceiverDeviceToken]).then(results =>{
            ReceiverSnapshotData = results[0].docs[0].data();
            ReceiverToken = ReceiverSnapshotData.device_instance_id;
            ReceiverUID = ReceiverSnapshotData.uid;
            
            // Notification details.
            const receiverPayload = {
                data: {
                action: newMessageReceived,
                sender: sender,
                conversation_id: context.params.chatConversationId,
                message_id: message.message_id,
                message_timestamp: `${message.time_stamp}`,
                }
            };

            return admin.messaging().sendToDevice(ReceiverToken, receiverPayload);
        }).then((response) => {
            // For each message check if there was an error.
            var tokenRemoved = false;
            response.results.forEach((result, index) => {
            const error = result.error;
            if (error) 
            {
                console.error('Failure sending notification to', ReceiverToken, error);
                // Cleanup the tokens who are not registered anymore.
                if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') 
                {
                    console.log('Removing token: ', ReceiverToken);
                    ReceiverToken = 'null';
                    tokenRemoved = true;
                }
            }

            });

            if(tokenRemoved){
                const returnTokens = admin.firestore().collection('users').doc(ReceiverUID).update('device_instance_id', ReceiverToken);
                return Promise.all([returnTokens]);
            } else {
                return 'sending to sender';
            }
        }).then((response) => {
            return Promise.all([SenderDeviceToken]).then(results => {
                SenderSnapshotData = results[0].docs[0].data();
                SenderToken = SenderSnapshotData.device_instance_id;
                SenderUID = SenderSnapshotData.uid;
                
                // Notification details.
                const senderPayload = {
                    data: {
                    action: newMessageSent,
                    receiver: receiver,
                    conversation_id: context.params.chatConversationId,
                    message_id: message.message_id,
                    }
                };

                return admin.messaging().sendToDevice(SenderToken, senderPayload);
            })
        }).then((response) => {
            // For each message check if there was an error.
            var tokenRemoved = false;
            response.results.forEach((result, index) => {
            const error = result.error;
            if (error) 
            {
                console.error('Failure sending notification to', SenderToken, error);
                // Cleanup the tokens who are not registered anymore.
                if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') 
                {
                    console.log('Removing token: ', SenderToken);
                    SenderToken = 'null';
                    tokenRemoved = true;
                }
            }

            });

            if(tokenRemoved){
                const returnTokens = admin.firestore().collection('users').doc(SenderUID).update('device_instance_id', SenderToken);
                return Promise.all([returnTokens]);
            }
        });
});


/*
    On deletion of a message
*/
exports.onDeleteMessage = functions.firestore
    .document('chat_conversations/{chatConversationId}/messages/{messageId}')
    .onDelete((snapshot, context) => {

        const newMessageDelivered = 'NEW_MESSAGE_DELIVERED';

        const message = snapshot.data();
        const receiver = message.receiver;

        const SenderDeviceToken = admin.firestore().collection('users').where('phone_number', '==', message.sender).get();

        let SenderSnapshotData;
        let SenderToken;
        let SenderUID;

        return Promise.all([SenderDeviceToken]).then(results =>{
            SenderSnapshotData = results[0].docs[0].data();
            SenderToken = SenderSnapshotData.device_instance_id;
            SenderUID = SenderSnapshotData.uid;
            
            // Notification details.
            const payload = {
                data: {
                action: newMessageDelivered,
                receiver: receiver,
                conversation_id: context.params.chatConversationId,
                message_id: message.message_id,
                delivery_timestamp: `${admin.firestore.Timestamp.now().toMillis() }`,
                }
            };

            return admin.messaging().sendToDevice(SenderToken, payload);
        }).then((response) => {
            // For each message check if there was an error.
            var tokenRemoved = false;
            response.results.forEach((result, index) => {
            const error = result.error;
            if (error) 
            {
                console.error('Failure sending notification to', SenderToken, error);
                // Cleanup the tokens who are not registered anymore.
                if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') 
                {
                    console.log('Removing token: ', SenderToken);
                    SenderToken = 'null';
                    tokenRemoved = true;
                }
            }

            });

            if(tokenRemoved){
                const returnTokens = admin.firestore().collection('users').doc(SenderUID).update('device_instance_id', SenderToken);
                return Promise.all([returnTokens]);
            }
        })
});


/*
    On creation of a new message receipt
*/
exports.onCreateMessageReceipt = functions.firestore
    .document('chat_conversations/{chatConversationId}/messages_receipts/{messageId}')
    .onCreate((snapshot, context) => {

        const newMessageRead = 'NEW_MESSAGE_READ';

        const messageReceipt = snapshot.data();
        const sender = messageReceipt.sender;

        const SenderDeviceToken = admin.firestore().collection('users').where('phone_number', '==', sender).get();
        const DeleteMessageReceipt = admin.firestore().collection('chat_conversations').doc(context.params.chatConversationId)
                                            .collection('messages_receipts').doc(context.params.messageId).delete();

        let SenderSnapshotData;
        let SenderToken;
        let SenderUID;

        return Promise.all([SenderDeviceToken, DeleteMessageReceipt]).then(results =>{
            SenderSnapshotData = results[0].docs[0].data();
            SenderToken = SenderSnapshotData.device_instance_id;
            SenderUID = SenderSnapshotData.uid;
            
            // Notification details.
            const payload = {
                data: {
                action: newMessageRead,
                conversation_id: context.params.chatConversationId,
                message_id: messageReceipt.message_id,
                read_timestamp: `${messageReceipt.timestamp}`,
                }
            };

            return admin.messaging().sendToDevice(SenderToken, payload);
        }).then((response) => {
            // For each message check if there was an error.
            var tokenRemoved = false;
            response.results.forEach((result, index) => {
            const error = result.error;
            if (error) 
            {
                console.error('Failure sending notification to', SenderToken, error);
                // Cleanup the tokens who are not registered anymore.
                if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') 
                {
                    console.log('Removing token: ', SenderToken);
                    SenderToken = 'null';
                    tokenRemoved = true;
                }
            }

            });

            if(tokenRemoved){
                const returnTokens = admin.firestore().collection('users').doc(SenderUID).update('device_instance_id', SenderToken);
                return Promise.all([returnTokens]);
            }
        })
});
