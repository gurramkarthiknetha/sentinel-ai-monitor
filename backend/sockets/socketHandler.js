export const initSocket = (io) => {
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("camera:subscribe", (cameraId) => {
      if (cameraId) {
        socket.join(`camera:${cameraId}`);
      }
    });

    socket.on("disconnect", () => {
      console.log("Disconnected:", socket.id);
    });
  });
};
