// public/js/chat.js
const socket = io(); 
// Lấy ID người dùng hiện tại từ input ẩn trong chat.ejs
const currentUserId = document.getElementById('current-user-id').value; 
let activeChatUser = null; 

// Khi nhấn nút gửi
document.getElementById('send-button').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Gửi tin nhắn
function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (content && activeChatUser) {
        socket.emit('send_private_message', {
            receiverId: activeChatUser.id,
            content: content
        });
        // Hiển thị tin nhắn của mình ngay lập tức
        displayMessage({ content: content, timestamp: new Date() }, true);
        input.value = ''; 
    }
}

// Hàm hiển thị tin nhắn vào khung chat
function displayMessage(message, isSelf) {
    const messagesArea = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = isSelf ? 'message self' : 'message other';
    messageElement.textContent = message.content;
    messagesArea.appendChild(messageElement);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Bắt đầu chat và tải lịch sử
async function startChat(userId, username) {
    activeChatUser = { id: userId, username: username };
    document.getElementById('chat-window-header').textContent = `Chat với ${username}`;
    document.getElementById('messages').innerHTML = ''; 
    
    // Kích hoạt input và nút gửi
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-button').disabled = false;
    document.getElementById('message-input').focus();
    
    // Đánh dấu người dùng đang chat
    document.querySelectorAll('#user-list li').forEach(li => li.classList.remove('active'));
    document.getElementById(`user-${userId}`).classList.add('active');

    // 1. Lấy lịch sử tin nhắn từ API
    try {
        const response = await fetch(`/api/messages/${userId}`);
        const messages = await response.json();

        // 2. Hiển thị lịch sử
        messages.forEach(msg => {
            const isSelf = msg.sender === currentUserId;
            displayMessage(msg, isSelf);
        });
    } catch (error) {
        console.error('Lỗi khi tải lịch sử chat:', error);
    }
}

// --- SOCKET.IO EVENTS ---

if (currentUserId) {
    socket.emit('register_user', currentUserId);
}

// Nhận thông báo trạng thái thay đổi
socket.on('user_status_change', (data) => {
    const userElement = document.getElementById(`user-${data.userId}`);
    if (userElement) {
        userElement.querySelector('.status-text').textContent = data.status;
        const dot = userElement.querySelector('.status-dot');
        dot.classList.remove('online', 'offline');
        dot.classList.add(data.status);
    }
});

// Nhận danh sách người dùng ban đầu
socket.on('initial_users', (users) => {
    const userList = document.getElementById('user-list');
    userList.innerHTML = ''; 
    users.forEach(user => {
        const status = user.online ? 'online' : 'offline';
        const userHtml = `<li id="user-${user._id}" onclick="startChat('${user._id}', '${user.username}')" class="user-item">
            <div class="user-info">
                ${user.username} 
                <span class="status-dot ${status}"></span>
                <span class="status-text">${status}</span>
            </div>
        </li>`;
        userList.innerHTML += userHtml;
    });
});

// Nhận tin nhắn mới từ người khác
socket.on('new_private_message', (data) => {
    // Chỉ hiển thị nếu tin nhắn đó thuộc về cuộc trò chuyện đang mở
    if (data.senderId === activeChatUser?.id || data.receiverId === activeChatUser?.id) {
        const isSelf = data.senderId === currentUserId;
        displayMessage(data, isSelf);
    } 
    // TODO: Thêm logic thông báo nếu tin nhắn không thuộc cuộc trò chuyện đang mở
});