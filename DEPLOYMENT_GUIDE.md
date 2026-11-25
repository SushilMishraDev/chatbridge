# ChatBridge Deployment Guide 🚀

ChatBridge is packaged as a unified full-stack application: **FastAPI serves both the backend API and the built React frontend from a single web service.**

---

## 🌟 Option 1: Free Cloud Deployment on Render.com (Recommended)

Render offers a free tier that can run ChatBridge using Docker without any server management.

### Step 1: Push your code to GitHub
1. Create a new repository on [GitHub](https://github.com).
2. Push this project folder to your repository:
   ```bash
   git init
   git add .
   git commit -m "Deploy ChatBridge"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/chatbridge.git
   git push -u origin main
   ```

### Step 2: Deploy on Render
1. Go to [dashboard.render.com](https://dashboard.render.com/) and sign in (free).
2. Click **New +** $\rightarrow$ **Web Service**.
3. Choose **Build and deploy from a Git repository** and connect your GitHub repo.
4. Render will automatically detect the `Dockerfile`:
   - **Name**: `chatbridge`
   - **Region**: Choose the closest region (e.g. Frankfurt, Oregon, Singapore)
   - **Branch**: `main`
   - **Plan**: **Free**
5. Click **Create Web Service**.
6. Render will build the Docker container and give you a live URL, for example:  
   `https://chatbridge-xxxx.onrender.com`

---

## 🚆 Option 2: Deploy on Railway.app

1. Sign in to [Railway.app](https://railway.app/).
2. Click **New Project** $\rightarrow$ **Deploy from GitHub repo**.
3. Select your ChatBridge repository.
4. Railway will automatically detect the `Dockerfile` or `Procfile`, build the React frontend, and deploy the FastAPI backend.
5. In your project settings, click **Generate Domain** to get your public HTTPS URL (e.g., `https://chatbridge.up.railway.app`).

---

## 🐳 Option 3: Deploy with Docker (VPS / Local Server / Cloud VM)

If you have a Linux server (Ubuntu, Debian, DigitalOcean droplet, AWS EC2):

1. **Build the Docker image**:
   ```bash
   docker build -t chatbridge .
   ```

2. **Run the container**:
   ```bash
   docker run -d -p 8000:8000 --name chatbridge -v $(pwd)/data:/app/data chatbridge
   ```

3. Open `http://your-server-ip:8000` in your browser.

---

## 🔌 How the Chrome Extension Works with Your Deployed Site

The ChatBridge Chrome extension is fully cloud-ready:

1. Open your deployed ChatBridge website (e.g., `https://chatbridge-xxxx.onrender.com`).
2. Log in with your email and password.
3. The extension (`auth_bridge.js`) will **automatically detect your deployed URL** and sync your token into the extension.
4. The green **`● Extension connected`** badge will appear on your live dashboard.
5. All chats captured from ChatGPT, Claude, and Gemini will now sync directly to your live cloud database!

---

## 🔑 Environment Variables Reference

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the Uvicorn web server |
| `JWT_SECRET` | Auto-generated in Docker | Secret key for signing user session tokens |
| `DATABASE_URL` | `sqlite:///./chatbridge.db` | Database connection string (supports SQLite or PostgreSQL) |
| `ANTHROPIC_API_KEY` | *(Optional)* | Anthropic key if you want Claude AI summaries |
| `OPENAI_API_KEY` | *(Optional)* | OpenAI key if you want GPT summaries |
