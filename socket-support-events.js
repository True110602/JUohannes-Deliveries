// Add these Socket.io event handlers to your server.js
// This handles real-time chat messages and WebRTC call signaling

const SupportChat = require('./models/SupportChat');

module.exports = function setupSupportSocket(io) {

  // Namespace for support conversations
  const supportNamespace = io.of('/support');

  supportNamespace.on('connection', (socket) => {
    console.log('👤 Support user connected:', socket.id);

    // User joins a support chat room
    socket.on('join_chat', async (data) => {
      const { chatId, userId, email, role } = data;
      socket.join(`chat_${chatId}`);

      console.log(`✅ User ${email} joined chat ${chatId}`);

      // Add participant if not already there
      try {
        const chat = await SupportChat.findById(chatId);
        if (chat) {
          const isParticipant = chat.participants.some(p => p.userId?.toString() === userId);
          if (!isParticipant) {
            chat.participants.push({ userId, email, role });
            await chat.save();
          }
        }
      } catch (err) {
        console.error('Error adding participant:', err);
      }

      // Notify others in the chat
      supportNamespace.to(`chat_${chatId}`).emit('user_joined', {
        email,
        role,
        message: `${email} joined the chat`
      });
    });

    // Send a chat message
    socket.on('send_message', async (data) => {
      const { chatId, senderId, senderName, senderRole, message } = data;

      try {
        // Save message to database
        const chat = await SupportChat.findByIdAndUpdate(
          chatId,
          {
            $push: {
              messages: {
                senderId,
                senderName,
                senderRole,
                text: message,
                timestamp: new Date()
              }
            }
          },
          { new: true }
        );

        // Broadcast message to all users in this chat
        supportNamespace.to(`chat_${chatId}`).emit('new_message', {
          senderId,
          senderName,
          senderRole,
          message,
          timestamp: new Date()
        });

        console.log(`💬 Message in chat ${chatId}: ${message.substring(0, 50)}...`);
      } catch (err) {
        console.error('Error saving message:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ==========================================
    // WebRTC Call Signaling
    // ==========================================

    // Initiate a call
    socket.on('call_initiate', (data) => {
      const { chatId, callerId, callerName, calleeId, callType } = data;

      console.log(`📞 Call initiated: ${callerName} calling in ${callType} mode`);

      // Notify the callee
      supportNamespace.to(`chat_${chatId}`).emit('incoming_call', {
        callerId,
        callerName,
        callType, // 'audio' or 'video'
        timestamp: new Date()
      });
    });

    // Send WebRTC offer
    socket.on('webrtc_offer', (data) => {
      const { chatId, offer, to } = data;
      supportNamespace.to(`chat_${chatId}`).emit('webrtc_offer', {
        offer,
        from: socket.id
      });
    });

    // Send WebRTC answer
    socket.on('webrtc_answer', (data) => {
      const { chatId, answer } = data;
      supportNamespace.to(`chat_${chatId}`).emit('webrtc_answer', {
        answer,
        from: socket.id
      });
    });

    // Send ICE candidate
    socket.on('webrtc_ice_candidate', (data) => {
      const { chatId, candidate } = data;
      supportNamespace.to(`chat_${chatId}`).emit('webrtc_ice_candidate', {
        candidate,
        from: socket.id
      });
    });

    // Call answered
    socket.on('call_answered', (data) => {
      const { chatId, answeredBy } = data;
      supportNamespace.to(`chat_${chatId}`).emit('call_connected', {
        answeredBy,
        message: 'Call connected'
      });
    });

    // Call rejected
    socket.on('call_rejected', (data) => {
      const { chatId, reason } = data;
      supportNamespace.to(`chat_${chatId}`).emit('call_rejected', {
        reason: reason || 'Call was rejected'
      });
    });

    // Call ended
    socket.on('call_ended', (data) => {
      const { chatId, duration } = data;
      supportNamespace.to(`chat_${chatId}`).emit('call_ended', {
        duration,
        message: 'Call ended'
      });
      console.log(`📞 Call ended. Duration: ${duration}s`);
    });

    // User leaves chat
    socket.on('leave_chat', (data) => {
      const { chatId, email } = data;
      socket.leave(`chat_${chatId}`);

      supportNamespace.to(`chat_${chatId}`).emit('user_left', {
        email,
        message: `${email} left the chat`
      });

      console.log(`❌ User ${email} left chat ${chatId}`);
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log('👤 Support user disconnected:', socket.id);
    });
  });
};
