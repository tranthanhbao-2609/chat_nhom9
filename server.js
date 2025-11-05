const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser'); // Cần phải cài đặt: npm install cookie-parser

// Import Models
const User = require('./models/User');
const Message = require('./models/Message');

// --- 1. KHỞI TẠO CỐT LÕI (BẮT BUỘC PHẢI Ở ĐÂY HOẶC TRƯỚC CÁC APP.USE/APP.POST) ---
const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*" } }); 
const JWT_SECRET = 'your_super_secret_key'; 

// --- 2. KẾT NỐI DB VÀ MIDDLEWARE ---

// Kết nối DB (Kiểm tra xem MongoDB Server đang chạy)
mongoose.connect('mongodb://localhost:27017/chatappdb')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('MongoDB connection error:', err));

// Cấu hình Middleware 
app.use(express.json()); 
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser()); // Sử dụng thư viện cookie-parser
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs'); 

// Middleware xác thực JWT (Kiểm tra token trong cookie)
const auth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/'); 
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded.user;
        next();
    } catch (e) {
        res.clearCookie('token');
        return res.redirect('/');
    }
};

// --- 3. ROUTES XỬ LÝ HTTP (Sử dụng APP) ---

// Trang Đăng nhập/Đăng ký
app.get('/', (req, res) => res.render('login', { error: null }));

// Route Đăng ký
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        let user = await User.findOne({ username });
        if (user) return res.render('login', { error: 'Tên người dùng đã tồn tại' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({ username, password: hashedPassword });
        await user.save();
        
        res.render('login', { error: 'Đăng ký thành công! Hãy đăng nhập.' });

    } catch (err) {
        console.error(err.message);
        res.render('login', { error: 'Lỗi Server' });
    }
});

// Route Đăng nhập
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.render('login', { error: 'Thông tin đăng nhập không hợp lệ' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.render('login', { error: 'Thông tin đăng nhập không hợp lệ' });

        const payload = { user: { id: user.id, username: user.username } };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

        res.cookie('token', token, { httpOnly: true }); 
        res.redirect('/chat');

    } catch (err) {
        console.error(err.message);
        res.render('login', { error: 'Lỗi Server' });
    }
});

// Trang Chat chính
app.get('/chat', auth, async (req, res) => {
    res.render('chat', { currentUser: req.user });
});

// API lấy lịch sử tin nhắn
app.get('/api/messages/:receiverId', auth, async (req, res) => {
    const senderId = req.user.id;
    const receiverId = req.params.receiverId;

    try {
        const messages = await Message.find({
            $or: [
                { sender: senderId, receiver: receiverId },
                { sender: receiverId, receiver: senderId }
            ]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ msg: 'Lỗi khi tải tin nhắn' });
    }
});


// --- 4. SOCKET.IO SERVER (REAL-TIME) ---
const usersOnline = {}; 

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Đăng ký người dùng online
    socket.on('register_user', async (userId) => {
        if (!userId) return;
        
        usersOnline[userId] = socket.id;
        socket.userId = userId;

        await User.findByIdAndUpdate(userId, { online: true });
        io.emit('user_status_change', { userId, status: 'online' }); 
        
        const users = await User.find({ _id: { $ne: userId } });
        socket.emit('initial_users', users); 
    });

    // Xử lý Gửi tin nhắn 1-1
    socket.on('send_private_message', async (data) => {
        const { receiverId, content } = data;
        const senderId = socket.userId;
        
        if (!senderId || !receiverId || !content) return;

        // Lưu vào Database
        const newMessage = new Message({ sender: senderId, receiver: receiverId, content });
        await newMessage.save();

        // Gửi cho người nhận (nếu online)
        const receiverSocketId = usersOnline[receiverId];
        if (receiverSocketId) {
            const messageData = { 
                senderId, 
                receiverId, 
                content, 
                timestamp: newMessage.timestamp 
            };
            io.to(receiverSocketId).emit('new_private_message', messageData);
        }
    });

    // Khi người dùng ngắt kết nối
    socket.on('disconnect', async () => {
        const userId = socket.userId;
        
        if (userId) {
            delete usersOnline[userId];
            await User.findByIdAndUpdate(userId, { online: false });
            io.emit('user_status_change', { userId, status: 'offline' });
        }
    });
});

// --- 5. KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));