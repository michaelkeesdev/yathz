# 🎲 Yahtzee Game Server

A Node.js server to host the Yahtzee game application.

## 📋 Prerequisites

- Node.js (version 14 or higher)
- npm (version 6 or higher)

## 🚀 Quick Setup

1. **Create project directory:**
   ```bash
   mkdir yahtzee-server
   cd yahtzee-server
   ```

2. **Create the files:**
   - Copy `server.js` to the root directory
   - Copy `package.json` to the root directory
   - Create a `public` directory
   - Place your `index.html` file inside the `public` directory

3. **Directory structure should look like:**
   ```
   yahtzee-server/
   ├── server.js
   ├── package.json
   └── public/
       └── index.html
   ```

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Start the server:**
   ```bash
   npm start
   ```

6. **Access the game:**
   Open your browser and go to `http://localhost:3000`

## 🛠️ Development Mode

For development with auto-restart on file changes:

```bash
npm run dev
```

## 🌐 Production Deployment

### Environment Variables
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

### AWS EC2 Deployment
```bash
# Install Node.js on EC2
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone/upload your project
# Install dependencies
npm install --production

# Start with PM2 for production
sudo npm install -g pm2
pm2 start server.js --name "yahtzee-game"
pm2 startup
pm2 save
```

### Docker Deployment
Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t yahtzee-game .
docker run -p 3000:3000 yahtzee-game
```

## 🔧 Server Features

- ✅ Serves static files from `public/` directory
- ✅ Health check endpoint at `/health`
- ✅ Custom 404 error pages
- ✅ Error handling middleware
- ✅ Graceful shutdown handling
- ✅ Environment variable support

## 📡 API Endpoints

- `GET /` - Serves the Yahtzee game
- `GET /health` - Health check endpoint
- Static files served from `/public` directory

## 🔍 Troubleshooting

**Server won't start:**
- Check if port 3000 is available
- Ensure Node.js is installed correctly
- Run `npm install` to install dependencies

**Game not loading:**
- Verify `index.html` is in the `public/` directory
- Check browser console for errors
- Ensure file permissions are correct

**Can't access from other devices:**
- Server runs on `0.0.0.0:3000` by default
- Check firewall settings
- Use your machine's IP address: `http://YOUR_IP:3000`

## 🎯 Next Steps

This server currently serves the static game files. For true multiplayer functionality across different devices/locations, you would need to add:

- WebSocket support for real-time communication
- Session management
- Database integration for persistent game state
- User authentication

## 📝 License

MIT License - feel free to modify and use as needed!