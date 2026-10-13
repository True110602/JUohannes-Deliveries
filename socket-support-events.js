// socket-support-events.js
const SupportChat = require('./models/SupportChat');

module.exports = function setupSupportSocket(io) {
  const supportNamespace = io.of('/support');
  const activeCalls = new Map();

  supportNamespace.on('connection', (socket) => {
    console.log('👤 Support user connected:', socket.id);

    socket.on('join_chat', async (data) => {
      const { chatId, userId, email, role } = data;
      socket.join(`chat_${chatId}`);
      try {
        const chat = await SupportChat.findById(chatId);
        if (chat) {
          const isParticipant = chat.participants.some(p => p.userId?.toString() === userId);
          if (!isParticipant) {
            chat.participants.push({ userId, email, role });
            await chat.save();
          }
        }
      } catch (err) { console.error('Join error:', err); }
      supportNamespace.to(`chat_${chatId}`).emit('user_joined', { email, role, message: `${email} joined` });
    });

    socket.on('send_message', async (data) => {
      const { chatId, senderId, senderName, senderRole, message } = data;
      try {
        await SupportChat.findByIdAndUpdate(chatId, {
          $push: { messages: { senderId, senderName, senderRole, text: message, timestamp: new Date() } }
        });
        supportNamespace.to(`chat_${chatId}`).emit('new_message', { senderId, senderName, senderRole, message, timestamp: new Date() });
      } catch (err) { socket.emit('error', { message: 'Failed to send message' }); }
    });

    socket.on('call_initiate', (data) => {
      const { chatId, callerId, callerName, callType } = data;
      activeCalls.set(socket.id, { chatId, partnerId: callerId });
      supportNamespace.to(`chat_${chatId}`).emit('incoming_call', { callerId, callerName, callType, timestamp: new Date() });
    });

    socket.on('call_answered', (data) => {
      const { chatId, answeredBy } = data;
      activeCalls.set(socket.id, { chatId, partnerId: answeredBy });
      supportNamespace.to(`chat_${chatId}`).emit('call_connected', { answeredBy, message: 'Call connected' });
    });

    socket.on('call_ended', (data) => {
      const { chatId, duration } = data;
      activeCalls.delete(socket.id);
      supportNamespace.to(`chat_${chatId}`).emit('call_ended', { duration, message: 'Call ended' });
    });

    socket.on('webrtc_offer', (data) => {
      supportNamespace.to(`chat_${data.chatId}`).emit('webrtc_offer', { offer: data.offer, from: socket.id });
    });

    socket.on('webrtc_answer', (data) => {
      supportNamespace.to(`chat_${data.chatId}`).emit('webrtc_answer', { answer: data.answer, from: socket.id });
    });

    socket.on('webrtc_ice_candidate', (data) => {
      supportNamespace.to(`chat_${data.chatId}`).emit('webrtc_ice_candidate', { candidate: data.candidate, from: socket.id });
    });

    socket.on('leave_chat', (data) => {
      socket.leave(`chat_${data.chatId}`);
      supportNamespace.to(`chat_${data.chatId}`).emit('user_left', { email: data.email });
    });

    socket.on('disconnect', () => {
      const call = activeCalls.get(socket.id);
      if (call) {
        supportNamespace.to(`chat_${call.chatId}`).emit('call_rejected', { reason: 'User disconnected unexpectedly' });
        activeCalls.delete(socket.id);
      }
    });
  });
};
