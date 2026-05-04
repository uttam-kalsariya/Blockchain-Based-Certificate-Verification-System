import './style.css'
import { BrowserProvider } from 'ethers'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5001/api'
const SIGN_MESSAGE_PREFIX = 'Certificate issuance approval'

type Role = 'user' | 'admin' | 'main_admin' | ''

type AuthUser = {
  email: string
  role: Role
  platform?: string | null
  name?: string
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  isMetaMask?: boolean
}

declare global {
  interface Window {
    ethereum?: EthereumProvider & {
      providers?: EthereumProvider[]
    }
  }
}

let authToken = localStorage.getItem('authToken') ?? ''
let currentUser: AuthUser | null = null
let connectedWalletAddress = ''

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found')
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Blockchain Certificate Verification</p>
        <h1>Role Based Certificate Portal</h1>
      </div>
      <div class="session-box">
        <span id="session-status">Not logged in</span>
        <button id="logout-btn" type="button" class="secondary hidden">Logout</button>
      </div>
    </header>

    <section id="login-panel" class="panel login-panel">
      <div class="login-copy">
        <p class="eyebrow">Secure Access</p>
        <h2>Choose a dashboard</h2>
        <p class="muted">User uploads certificates, LinkedIn/Coursera approve platform requests, and Admin sees all data.</p>
        <div class="role-preview">
          <span>User</span>
          <span>LinkedIn</span>
          <span>Coursera</span>
          <span>Admin</span>
        </div>
      </div>
      <div class="login-card">
        <form id="login-form" class="form-grid">
          <label>
            Email
            <input type="email" name="email" placeholder="user@cert.com" required />
          </label>
          <label>
            Password
            <input type="password" name="password" placeholder="user123" required />
          </label>
          <button type="submit">Login</button>
        </form>
        <div class="demo-grid">
          <button type="button" data-demo-email="user@cert.com" data-demo-password="user123">User</button>
          <button type="button" data-demo-email="linkedin@cert.com" data-demo-password="linkedin123">LinkedIn</button>
          <button type="button" data-demo-email="coursera@cert.com" data-demo-password="coursera123">Coursera</button>
          <button type="button" data-demo-email="admin@cert.com" data-demo-password="admin123">Admin</button>
        </div>
        <pre id="login-result" class="result compact"></pre>
      </div>
    </section>

    <section id="dashboard-panel" class="panel hidden">
      <div class="dashboard-head">
        <div>
          <h2 id="dashboard-title">Dashboard</h2>
          <p id="dashboard-subtitle" class="muted"></p>
        </div>
        <div class="wallet-row">
          <button id="connect-wallet-btn" type="button" class="secondary">Connect MetaMask</button>
          <span id="wallet-status" class="wallet-status">Wallet: Not connected</span>
        </div>
      </div>
      <div id="stats-grid" class="stats-grid"></div>
    </section>

    <section id="user-panel" class="panel hidden">
      <div class="section-head">
        <div>
          <h2>User Upload</h2>
          <p class="muted">Submit PDF/image certificate with wallet signature for approval.</p>
        </div>
      </div>
      <form id="upload-certificate-form" class="form-grid">
        <div class="input-tabs" style="display: flex; gap: 10px; margin-bottom: 15px;">
           <button type="button" id="tab-file" class="tab-btn active" style="flex:1; font-size: 0.8rem;">Upload PDF</button>
           <!-- <button type="button" id="tab-link" class="tab-btn" style="flex:1; font-size: 0.8rem;">LinkedIn Link</button> -->
        </div>

        <div id="file-input-group">
          <label>
            Certificate File (PDF)
            <input type="file" name="certificate_file" accept=".pdf" />
          </label>
        </div>

        <div id="link-input-group" style="display: none;">
          <label>
            LinkedIn Certificate URL
            <input type="url" name="linkedin_url" placeholder="https://www.linkedin.com/learning/certificates/..." />
          </label>
        </div>

        <button type="submit" id="scan-btn">Scan Certificate Details</button>
      </form>
      <pre id="upload-result" class="result compact"></pre>
    </section>

    <section id="admin-panel" class="panel hidden">
      <div class="section-head">
        <div>
          <h2 id="admin-title">Admin Panel</h2>
          <p id="admin-subtitle" class="muted"></p>
        </div>
        <button id="refresh-pending-btn" type="button" class="secondary">Refresh</button>
      </div>
      <div id="pending-list" class="table-like">Login required.</div>
    </section>

    <section id="verify-panel" class="panel">
      <div class="section-head">
        <div>
          <h2>Verify Certificate</h2>
          <p class="muted">Search by approved certificate ID or blockchain hash.</p>
        </div>
      </div>
      <form id="verify-form" class="form-grid two-col">
        <label>
          Certificate ID
          <input type="text" name="certificate_id" />
        </label>
        <label>
          Certificate Hash
          <input type="text" name="cert_hash" />
        </label>
        <button type="submit">Verify</button>
      </form>
      <pre id="verify-result" class="result compact"></pre>
    </section>

    <section id="records-panel" class="panel hidden">
      <div class="section-head">
        <div>
          <h2 id="records-title">Records</h2>
          <p id="records-subtitle" class="muted"></p>
        </div>
        <button id="refresh-certificates-btn" type="button" class="secondary">Refresh</button>
      </div>
      <div id="certificate-list" class="table-like">Login required.</div>
    </section>
  </main>
`

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }
  return element
}

const loginPanel = required<HTMLElement>('#login-panel')
const dashboardPanel = required<HTMLElement>('#dashboard-panel')
const userPanel = required<HTMLElement>('#user-panel')
const adminPanel = required<HTMLElement>('#admin-panel')
const recordsPanel = required<HTMLElement>('#records-panel')
const loginForm = required<HTMLFormElement>('#login-form')
const uploadForm = required<HTMLFormElement>('#upload-certificate-form')
const verifyForm = required<HTMLFormElement>('#verify-form')
const logoutBtn = required<HTMLButtonElement>('#logout-btn')
const connectWalletBtn = required<HTMLButtonElement>('#connect-wallet-btn')
const refreshCertificatesBtn = required<HTMLButtonElement>('#refresh-certificates-btn')
const refreshPendingBtn = required<HTMLButtonElement>('#refresh-pending-btn')
const sessionStatus = required<HTMLElement>('#session-status')
const dashboardTitle = required<HTMLElement>('#dashboard-title')
const dashboardSubtitle = required<HTMLElement>('#dashboard-subtitle')
const adminTitle = required<HTMLElement>('#admin-title')
const adminSubtitle = required<HTMLElement>('#admin-subtitle')
const recordsTitle = required<HTMLElement>('#records-title')
const recordsSubtitle = required<HTMLElement>('#records-subtitle')
const statsGrid = required<HTMLElement>('#stats-grid')
const loginResult = required<HTMLElement>('#login-result')
const uploadResult = required<HTMLElement>('#upload-result')
const verifyResult = required<HTMLElement>('#verify-result')
const walletStatus = required<HTMLElement>('#wallet-status')
const pendingList = required<HTMLElement>('#pending-list')
const certificateList = required<HTMLElement>('#certificate-list')

const pretty = (payload: unknown): string => JSON.stringify(payload, null, 2)
const shortWallet = (value: string): string =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : 'Not connected'
const platformLabel = (value?: string | null): string =>
  value === 'linkedin' ? 'LinkedIn' : value === 'coursera' ? 'Coursera' : 'Global'
const badge = (label: string, tone = ''): string => `<span class="badge ${tone.toLowerCase()}">${label}</span>`

function setHidden(element: HTMLElement, hidden: boolean) {
  element.classList.toggle('hidden', hidden)
}

function getAuthHeaders(): HeadersInit {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {}
}

function getMetaMaskProvider() {
  const ethereum = window.ethereum
  if (!ethereum) return undefined
  if (ethereum.providers?.length) {
    return ethereum.providers.find((provider) => provider.isMetaMask) ?? ethereum
  }
  return ethereum
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers ?? {}),
    },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.message ?? 'Request failed.')
  }
  return data
}

async function ensureWalletConnected(): Promise<string> {
  const injectedProvider = getMetaMaskProvider()
  if (!injectedProvider) {
    throw new Error('MetaMask not found. Please install MetaMask extension.')
  }

  const provider = new BrowserProvider(injectedProvider)
  const accounts = (await provider.send('eth_requestAccounts', [])) as string[]
  if (!accounts.length) {
    throw new Error('Wallet connection failed.')
  }

  connectedWalletAddress = accounts[0]
  walletStatus.textContent = `Wallet: ${shortWallet(connectedWalletAddress)}`
  walletStatus.classList.add('connected')
  return connectedWalletAddress
}

function renderRoleShell() {
  const role = currentUser?.role ?? ''
  const isLoggedIn = Boolean(currentUser && authToken)
  const isAdmin = role === 'admin' || role === 'main_admin'

  setHidden(loginPanel, isLoggedIn)
  setHidden(dashboardPanel, !isLoggedIn)
  setHidden(userPanel, !(role === 'user' || role === 'main_admin'))
  setHidden(adminPanel, !isAdmin)
  setHidden(recordsPanel, !isLoggedIn)
  setHidden(logoutBtn, !isLoggedIn)

  sessionStatus.textContent = isLoggedIn
    ? `${currentUser?.name ?? currentUser?.email} | ${role.replace('_', ' ')}`
    : 'Not logged in'
  dashboardTitle.textContent =
    role === 'main_admin' ? 'Admin Dashboard' : role === 'admin' ? `${platformLabel(currentUser?.platform)} Dashboard` : 'User Dashboard'
  dashboardSubtitle.textContent =
    role === 'main_admin'
      ? 'Shows all user uploads, LinkedIn/Coursera approvals, and blockchain records.'
      : role === 'admin'
        ? `${platformLabel(currentUser?.platform)} admin can approve only own platform certificates.`
        : 'Upload certificate with MetaMask signature and track own approved records.'
  adminTitle.textContent = role === 'main_admin' ? 'Admin Approval Queue' : `${platformLabel(currentUser?.platform)} Approval Queue`
  adminSubtitle.textContent =
    role === 'main_admin' ? 'All LinkedIn and Coursera requests are visible.' : `${platformLabel(currentUser?.platform)} requests only.`
  recordsTitle.textContent = role === 'main_admin' ? 'All Certificate Data' : role === 'admin' ? 'Platform Certificate Data' : 'My Certificates'
  recordsSubtitle.textContent =
    role === 'main_admin' ? 'Main admin sees every approved certificate.' : role === 'admin' ? `${platformLabel(currentUser?.platform)} approved records.` : 'Only certificates submitted by this user.'
}

async function loadSummary() {
  if (!authToken) return
  try {
    const data = await apiFetch('/panel/summary')
    statsGrid.innerHTML = [
      ['Approved Certificates', data.certificates],
      ['Pending Requests', data.requests?.pending ?? 0],
      ['Approved Requests', data.requests?.approved ?? 0],
      ['Rejected Requests', data.requests?.rejected ?? 0],
    ]
      .map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
      .join('')
  } catch (error) {
    statsGrid.innerHTML = `<div class="stat error">${error instanceof Error ? error.message : 'Summary failed.'}</div>`
  }
}

async function copyToClipboard(text: string, element: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text)
    element.classList.add('copied')
    setTimeout(() => element.classList.remove('copied'), 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

async function loadCertificates() {
  if (!authToken) {
    certificateList.textContent = 'Login required.'
    return
  }
  certificateList.textContent = 'Loading certificates...'
  try {
    const data = await apiFetch('/certificates')
    const certificates = Array.isArray(data.certificates) ? data.certificates : []
    if (!certificates.length) {
      certificateList.innerHTML = '<div class="empty-state">No approved certificates.</div>'
      return
    }

    certificateList.innerHTML = certificates
      .map(
        (item: {
          id: number
          student_name: string
          student_id: string
          course: string
          platform: string
          cert_hash: string
          submitted_by?: string
          approved_by?: string
        }) => `
          <div class="record-row">
            <div class="record-main">
              <div class="eyebrow">BLOCKCHAIN RECORD #${item.id}</div>
              <strong style="font-size: 1.2rem;">${item.student_name}</strong>
              <span class="muted">${item.course}</span>
              <div style="margin-top: 10px; display: flex; align-items: center; gap: 10px;">
                ${badge(platformLabel(item.platform), item.platform)}
                <code class="copyable" data-copy="${item.cert_hash}" title="Click to copy hash">${item.cert_hash.slice(0, 16)}...</code>
              </div>
              <small class="muted" style="margin-top: 10px; display: block; font-size: 0.75rem;">
                Issued to ID: <span class="copyable" data-copy="${item.student_id}" title="Click to copy ID" style="color: var(--accent-primary); font-weight: 600;">${item.student_id}</span> 
                ${item.submitted_by ? ` | Sub: ${item.submitted_by}` : ''}
              </small>
            </div>
            <div class="record-side" style="display: flex; align-items: center;">
               ${badge('Verified', 'approved')}
            </div>
          </div>
        `,
      )
      .join('')

    // Add click handlers for copyable elements
    certificateList.querySelectorAll('.copyable').forEach((el) => {
      el.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement
        const text = target.dataset.copy ?? ''
        void copyToClipboard(text, target)
      })
    })
  } catch (error) {
    certificateList.textContent = error instanceof Error ? error.message : 'Failed to load certificates.'
  }
}


async function loadPendingCertificates() {
  if (!authToken || !['admin', 'main_admin'].includes(currentUser?.role ?? '')) {
    pendingList.textContent = 'LinkedIn, Coursera, or Admin login required.'
    return
  }
  pendingList.textContent = 'Loading pending certificates...'
  try {
    const data = await apiFetch('/admin/pending-certificates')
    const pending = Array.isArray(data.pending) ? data.pending : []
    if (!pending.length) {
      pendingList.innerHTML = '<div class="empty-state">No upload requests.</div>'
      return
    }

    pendingList.innerHTML = pending
      .map(
        (item: {
          id: number
          source_file_name: string
          student_name?: string
          course?: string
          platform: string
          status: string
          submitted_by?: string
          rejection_reason?: string
        }) => `
          <div class="record-row">
            <div class="record-main">
              <div class="eyebrow">PENDING APPROVAL</div>
              <strong>${item.student_name || item.source_file_name}</strong>
              <span class="muted">${item.course || 'Certificate Upload'}</span>
              <div style="margin-top: 10px;">
                ${badge(platformLabel(item.platform), item.platform)}
                ${badge(item.status, item.status)}
              </div>
              <small class="muted" style="margin-top: 8px; display: block;">From: ${item.submitted_by || 'Anonymous'}</small>
              ${item.rejection_reason ? `<small class="error" style="color: #ff0055;">Reason: ${item.rejection_reason}</small>` : ''}
            </div>
            <div class="actions" style="align-self: center;">
              ${item.status === 'pending'
            ? `
                      <button data-action="approve" data-id="${item.id}" type="button">Approve</button>
                      <button data-action="reject" data-id="${item.id}" type="button" class="danger">Reject</button>
                    `
            : ''
          }
            </div>
          </div>
        `,
      )
      .join('')
  } catch (error) {
    pendingList.textContent = error instanceof Error ? error.message : 'Failed to load pending requests.'
  }
}

async function refreshPanelData() {
  renderRoleShell()
  await Promise.all([loadSummary(), loadCertificates(), loadPendingCertificates()])
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const formData = new FormData(loginForm)
  loginResult.textContent = 'Logging in...'
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(formData.get('email') ?? '').trim(),
        password: String(formData.get('password') ?? ''),
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message ?? 'Login failed.')
    }
    authToken = String(data.token)
    currentUser = data.user
    localStorage.setItem('authToken', authToken)
    loginResult.textContent = ''
    await refreshPanelData()
  } catch (error) {
    loginResult.textContent = pretty({
      success: false,
      error: error instanceof Error ? error.message : 'Login failed.',
    })
  }
})

document.querySelectorAll<HTMLButtonElement>('[data-demo-email]').forEach((button) => {
  button.addEventListener('click', () => {
    const emailInput = loginForm.elements.namedItem('email') as HTMLInputElement
    const passwordInput = loginForm.elements.namedItem('password') as HTMLInputElement
    emailInput.value = button.dataset.demoEmail ?? ''
    passwordInput.value = button.dataset.demoPassword ?? ''
  })
})

logoutBtn.addEventListener('click', () => {
  authToken = ''
  currentUser = null
  localStorage.removeItem('authToken')
  renderRoleShell()
})

connectWalletBtn.addEventListener('click', async () => {
  try {
    connectWalletBtn.disabled = true
    walletStatus.textContent = 'Wallet: Connecting...'
    await ensureWalletConnected()
  } catch (error) {
    walletStatus.textContent = 'Wallet: Not connected'
    walletStatus.classList.remove('connected')
    uploadResult.textContent = pretty({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect wallet.',
    })
  } finally {
    connectWalletBtn.disabled = false
  }
})

// Tab Switching Logic
const tabFile = document.querySelector<HTMLButtonElement>('#tab-file')
const tabLink = document.querySelector<HTMLButtonElement>('#tab-link')
const fileGroup = document.querySelector<HTMLDivElement>('#file-input-group')
const linkGroup = document.querySelector<HTMLDivElement>('#link-input-group')
let activeTab: 'file' | 'link' = 'file'

tabFile?.addEventListener('click', () => {
  activeTab = 'file'
  tabFile.classList.add('active')
  tabLink?.classList.remove('active')
  fileGroup!.style.display = 'block'
  linkGroup!.style.display = 'none'
})

tabLink?.addEventListener('click', () => {
  activeTab = 'link'
  tabLink.classList.add('active')
  tabFile?.classList.remove('active')
  fileGroup!.style.display = 'none'
  linkGroup!.style.display = 'block'
})

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const formData = new FormData(uploadForm)
  const file = formData.get('certificate_file') as File
  const linkedinUrl = formData.get('linkedin_url') as string

  if (activeTab === 'file' && (!file || !file.name)) {
    uploadResult.innerHTML = `<p class="error">Please select a certificate file.</p>`
    return
  }

  if (activeTab === 'link' && !linkedinUrl) {
    uploadResult.innerHTML = `<p class="error">Please enter a LinkedIn certificate URL.</p>`
    return
  }

  uploadResult.innerHTML = '<div class="eyebrow">Fetching Data...</div>'
  try {
    let details: any;

    if (activeTab === 'file') {
      const previewData = await apiFetch('/certificates/preview', {
        method: 'POST',
        body: formData,
      })
      details = previewData.details
    } else {
      const previewData = await apiFetch('/certificates/fetch-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkedinUrl }),
      })
      details = previewData.details
    }

    const isDetected = details?.student_name !== 'Unknown Student' && details?.course !== 'Unknown Course';

    uploadResult.innerHTML = `
      <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid var(--accent-primary); padding: 25px; border-radius: 16px; margin-top: 20px;">
        <div class="eyebrow" style="color: var(--accent-primary);">1. REVIEW DETECTED DATA</div>
        <div style="display: grid; gap: 10px; margin: 15px 0;">
          <p><strong>Name:</strong> ${details?.student_name || 'Not Detected'}</p>
          <p><strong>Course:</strong> ${details?.course || 'Not Detected'}</p>
          <p><strong>ID:</strong> ${details?.student_id || 'Not Detected'}</p>
          <p><strong>Platform:</strong> ${details?.platform || 'Unknown'}</p>
        </div>
        ${isDetected
        ? `<button id="final-submit-btn" type="button" style="width: 100%; margin-top: 10px;">2. CONFIRM & SIGN WITH METAMASK</button>`
        : `<p class="error" style="color: #ff0055;">⚠️ Detection failed. Try uploading the PDF manually.</p>`
      }
      </div>
    `;

    const finalSubmitBtn = document.querySelector<HTMLButtonElement>('#final-submit-btn')
    if (finalSubmitBtn) {
      finalSubmitBtn.addEventListener('click', async () => {
        try {
          finalSubmitBtn.disabled = true
          finalSubmitBtn.textContent = 'Awaiting Wallet Signature...'

          const walletAddress = connectedWalletAddress || (await ensureWalletConnected())
          const injectedProvider = getMetaMaskProvider()
          if (!injectedProvider) throw new Error('MetaMask provider unavailable.')

          const provider = new BrowserProvider(injectedProvider)
          const signer = await provider.getSigner()

          // Use filename or URL for signature
          const identifier = activeTab === 'file' ? file.name : 'linkedin-link'
          const signature = await signer.signMessage(`${SIGN_MESSAGE_PREFIX}|${identifier}|${details.platform}`)

          const submissionData = new FormData()
          if (activeTab === 'file') submissionData.append('certificate_file', file)
          submissionData.append('wallet_address', walletAddress)
          submissionData.append('wallet_signature', signature)
          submissionData.append('linkedin_url', linkedinUrl || '')
          submissionData.append('extracted_name', details.student_name)
          submissionData.append('extracted_course', details.course)
          submissionData.append('extracted_id', details.student_id)

          await apiFetch('/certificates/upload', {
            method: 'POST',
            body: submissionData,
          })

          uploadResult.innerHTML = `
            <div style="background: rgba(0, 255, 136, 0.1); border: 1px solid #00ff88; padding: 20px; border-radius: 16px; margin-top: 20px;">
               <div class="eyebrow" style="color: #00ff88;">✓ SUCCESS</div>
               <p>Certificate successfully sent for approval!</p>
            </div>
          `
          uploadForm.reset()
          await refreshPanelData()
        } catch (err) {
          uploadResult.innerHTML += `<p class="error" style="color: #ff0055; margin-top: 10px;">${err instanceof Error ? err.message : 'Submission failed.'}</p>`
          finalSubmitBtn.disabled = false
          finalSubmitBtn.textContent = '2. CONFIRM & SIGN WITH METAMASK'
        }
      })
    }
  } catch (error) {
    uploadResult.innerHTML = `<p class="error">${error instanceof Error ? error.message : 'Fetch failed.'}</p>`
  }
})

pendingList.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
  if (!button) return
  const action = button.dataset.action
  const id = button.dataset.id
  if (!action || !id) return

  button.disabled = true
  try {
    const data = await apiFetch(`/admin/certificates/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: action === 'reject' ? JSON.stringify({ reason: 'Rejected by admin' }) : undefined,
    })
    uploadResult.textContent = pretty({ success: true, data })
    await refreshPanelData()
  } catch (error) {
    uploadResult.textContent = pretty({
      success: false,
      error: error instanceof Error ? error.message : 'Admin action failed.',
    })
  } finally {
    button.disabled = false
  }
})

verifyForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const formData = new FormData(verifyForm)
  const certificateId = String(formData.get('certificate_id') ?? '').trim()
  const certHash = String(formData.get('cert_hash') ?? '').trim()
  if (!certificateId && !certHash) {
    verifyResult.textContent = pretty({ success: false, message: 'Provide certificate ID or hash.' })
    return
  }

  verifyResult.innerHTML = '<div class="eyebrow">Checking certificate...</div>'
  try {
    const response = await fetch(`${API_BASE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificate_id: certificateId, cert_hash: certHash }),
    })
    const data = await response.json()

    if (!response.ok || !data.valid) {
      verifyResult.innerHTML = `
        <div class="verify-card error">
          <div class="eyebrow" style="color: #ff0055;">⚠️ Verification Failed</div>
          <p>${data.message || 'Certificate not found or invalid.'}</p>
        </div>
      `
      return
    }

    const cert = data.certificate
    const block = data.block

    verifyResult.innerHTML = `
      <div class="verify-card success">
        <div class="verify-header">
          <div class="eyebrow" style="color: #00ff88;">✓ VERIFIED RECORD</div>
          <h2>${cert.student_name}</h2>
          <p class="course-name">${cert.course}</p>
        </div>
        
        <div class="verify-body">
          <div class="info-grid">
            <div class="info-item">
              <label>Platform</label>
              <span>${platformLabel(cert.platform)}</span>
            </div>
            <div class="info-item">
              <label>Issue Date</label>
              <span>${cert.issue_date}</span>
            </div>
            <div class="info-item">
              <label>Student ID</label>
              <span class="mono">${cert.student_id}</span>
            </div>
            <div class="info-item">
              <label>Blockchain Hash</label>
              <span class="mono">${cert.cert_hash.slice(0, 20)}...</span>
            </div>
          </div>
          
          <div class="blockchain-meta">
            <div class="eyebrow">Blockchain Proof</div>
            <p>Confirmed in <strong>Block #${block.block_index}</strong></p>
            <p class="mono small">${block.current_hash}</p>
          </div>
        </div>
      </div>
    `
  } catch (error) {
    verifyResult.innerHTML = `
      <div class="verify-card error">
        <div class="eyebrow" style="color: #ff0055;">⚠️ Error</div>
        <p>${error instanceof Error ? error.message : 'Verification failed.'}</p>
      </div>
    `
  }
})


refreshCertificatesBtn.addEventListener('click', loadCertificates)
refreshPendingBtn.addEventListener('click', loadPendingCertificates)

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', (accounts) => {
    const changedAccounts = accounts as string[]
    connectedWalletAddress = changedAccounts[0] ?? ''
    walletStatus.textContent = `Wallet: ${shortWallet(connectedWalletAddress)}`
    walletStatus.classList.toggle('connected', Boolean(connectedWalletAddress))
  })
}

async function restoreSession() {
  if (!authToken) {
    renderRoleShell()
    return
  }
  try {
    const data = await apiFetch('/auth/me')
    currentUser = data.user
    await refreshPanelData()
  } catch {
    authToken = ''
    currentUser = null
    localStorage.removeItem('authToken')
    renderRoleShell()
  }
}

void restoreSession()
