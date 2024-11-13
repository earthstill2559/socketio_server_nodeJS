const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);

const PORT = 3000;
const HOST = '0.0.0.0';

// เชื่อมต่อกับฐานข้อมูล SQLite
const db = new sqlite3.Database('./chatApp.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected successfully');

    // ตรวจสอบว่า คอลัมน์ socketId มีอยู่แล้วหรือไม่
    db.all("PRAGMA table_info(messages);", (err, columns) => {
      if (err) {
        console.error('Error fetching table info:', err);
      } else {
        const hasSocketIdColumn = columns.some(column => column.name === 'socketId');
        
        // ถ้ายังไม่มีคอลัมน์ socketId, เพิ่มคอลัมน์
        if (!hasSocketIdColumn) {
          db.run('ALTER TABLE messages ADD COLUMN socketId TEXT', (err) => {
            if (err) {
              console.error('Error adding socketId column:', err);
            } else {
              console.log('socketId column added successfully');
            }
          });
        } else {
          console.log('socketId column already exists');
        }
      }
    });
  }
});



const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

let roomom = 1;
let rooms = {};

io.on('connection', (socket) => {
  console.log('A user connected: ' + socket.id);

  let currentRoom = 'room' + roomom;
  if (!rooms[currentRoom]) {
    rooms[currentRoom] = [];
  }

  if (rooms[currentRoom].length < 2) {
    socket.join(currentRoom);
    rooms[currentRoom].push(socket.id);

    io.to(currentRoom).emit('ConnectedRoom', {
      room: roomom,
      users: rooms[currentRoom].length
    });

    console.log(`User ${socket.id} joined ${currentRoom} (${rooms[currentRoom].length}/2 users)`);

    if (rooms[currentRoom].length >= 2) {
      roomom++;
    }
  }

  // Handle sendMessage
  socket.on('sendMessage', (msg) => {
    let userRoom = Object.keys(socket.rooms)[1];

    // ตรวจสอบประเภทของข้อความและ socketId
    let messageToSave = typeof msg === 'string' ? msg : (msg.text ? msg.text : JSON.stringify(msg));
    let socketId = socket.id; // เก็บ socketId

    // บันทึกข้อความลงในฐานข้อมูล SQLite พร้อมกับ socketId
    db.run('INSERT INTO messages (message, socketId) VALUES (?, ?)', [messageToSave, socketId], function (err) {
      if (err) {
        console.error('Error saving message:', err);
      } else {
       // console.log('Message saved to database with socketId');
      }
    });

    io.to(userRoom).emit('broadcastMessage', {
      message: messageToSave,
      room: userRoom
    });
  });

  // รับข้อความจาก client
  socket.on('sendMessage', (msg) => {
    console.log('Received message from client:', JSON.stringify(msg));

    if (typeof msg === 'string') {
      // ถ้าเป็นข้อความ string
      socket.emit('receiveMessage', `Server received your message: "${msg}"`);
      socket.broadcast.emit('broadcastMessage', `New message from Website: ${msg}`);
    } else if (msg.text) {
      // ถ้าเป็น object ที่มี property text
      socket.emit('receiveMessage', `Server received your message: "${msg.text}"`);
      socket.broadcast.emit('broadcastMessage', `New message from Mobile: "${msg.text}"`);
    } else {
      // ถ้าเป็น object ที่ไม่มี property text
      socket.emit('receiveMessage', `Server received an unknown message.`);
      socket.broadcast.emit('broadcastMessage', `New message from Mobile: ${JSON.stringify(msg)}`);
    }
  });

  // เมื่อส่งข้อความไปยัง client
socket.on('sendMessage', (msg) => {
  let userRoom = Object.keys(socket.rooms)[1];
  let messageToSave = typeof msg === 'string' ? msg : (msg.text ? msg.text : JSON.stringify(msg));
  let socketId = socket.id;  // เก็บ socketId เพื่อใช้ในข้อความ



  // ส่งข้อมูลผู้ส่งพร้อมข้อความ
  io.to(userRoom).emit('broadcastMessage', {
    sender: socket.id,  // ใช้ socketId หรือชื่อผู้ใช้ที่คุณตั้งค่า
    message: messageToSave,
    room: userRoom
  });
});
// เมื่อส่งข้อความไปยัง client
socket.on('sendMessage', (msg) => {
  let userRoom = Object.keys(socket.rooms)[1];
  let messageToSave = typeof msg === 'string' ? msg : (msg.text ? msg.text : JSON.stringify(msg));
  let socketId = socket.id;  // เก็บ socketId เพื่อใช้ในข้อความ

  // ส่งข้อมูลผู้ส่งพร้อมข้อความ
  io.to(userRoom).emit('broadcastMessage', {
    sender: socket.id,  // ใช้ socketId หรือชื่อผู้ใช้ที่คุณตั้งค่า
    message: messageToSave,
    room: userRoom
  });
});


  // Handle disconnection
  socket.on('disconnect', () => {
    let userRoom = Object.keys(socket.rooms)[1];
    if (rooms[userRoom]) {
      rooms[userRoom] = rooms[userRoom].filter(id => id !== socket.id);
    }
  });

  // ฟังก์ชันดึงข้อความจากฐานข้อมูล
  socket.on('getMessages', () => {
    db.all('SELECT message, socketId, timestamp FROM messages ORDER BY timestamp DESC LIMIT 10', [], (err, rows) => {
      if (err) {
        console.error('Error fetching messages:', err);
      } else {
        // ตรวจสอบข้อความก่อนส่งให้ client
        rows.forEach(row => {
          row.message = typeof row.message === 'object' ? JSON.stringify(row.message) : row.message;
        });
        socket.emit('loadMessages', rows);  // ส่งข้อความย้อนหลังให้ client
      }
    });
  });
});

// จัดการข้อผิดพลาดที่เกิดจากพอร์ตที่ใช้แล้ว
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Trying another port...`);
    server.close();
    server.listen(PORT + 1, HOST, () => {
      console.log(`Server is running on http://192.168.1.177:${PORT + 1}`);
    });
  } else {
    console.error('Server error:', err);
  }
});

// รันเซิร์ฟเวอร์ที่ IP address 0.0.0.0 และพอร์ต 3000
server.listen(PORT, HOST, () => {
  console.log(`Server is running on http://192.168.1.177:${PORT}`);
});
