/**
 * Send Task Notifications API
 * 
 * POST /api/send-task-notifications
 * 
 * Sends email notifications to assigned users when tasks are extracted.
 * This endpoint is called asynchronously after task extraction completes.
 * 
 * Request body:
 * {
 *   meetingId: string,
 *   tasks: Task[]
 * }
 * 
 * Features:
 * - Uses Resend for reliable email delivery
 * - Non-blocking (fire-and-forget from client perspective)
 * - Groups tasks by assignee to avoid spam
 * - Professional, minimal email format
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// FIREBASE ADMIN SETUP
// ============================================
function initAdmin() {
  if (getApps().length > 0) return getApps()[0];

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
  });
}

function getAdminDb() {
  initAdmin();
  return getFirestore();
}

// ============================================
// TYPES
// ============================================
interface TaskForEmail {
  id: string;
  title: string;
  description?: string;
  priority: string;
  dueDate?: string;
  assignedToEmail: string;
  assignedToName: string;
  meetingTitle?: string;
}

interface NotificationRequest {
  meetingId: string;
  meetingTitle: string;
  tasks: TaskForEmail[];
  creatorName?: string;
}

// ============================================
// EMAIL HTML TEMPLATE
// ============================================
function generateTaskEmailHtml(
  assigneeName: string,
  tasks: TaskForEmail[],
  meetingTitle: string,
  creatorName: string,
  dashboardUrl: string
): string {
  const taskRows = tasks.map(task => {
    const priorityColor = 
      task.priority === 'critical' ? '#dc2626' :
      task.priority === 'high' ? '#ea580c' :
      task.priority === 'medium' ? '#d97706' : '#64748b';
    
    const dueText = task.dueDate 
      ? `Due: ${new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';

    return `
      <tr>
        <td style="padding: 16px; border-bottom: 1px solid #e2e8f0;">
          <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">${task.title}</div>
          ${task.description ? `<div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">${task.description.substring(0, 100)}${task.description.length > 100 ? '...' : ''}</div>` : ''}
          <div style="display: flex; gap: 12px; font-size: 12px;">
            <span style="background: ${priorityColor}15; color: ${priorityColor}; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; font-weight: 600;">${task.priority}</span>
            ${dueText ? `<span style="color: #64748b;">${dueText}</span>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="font-size: 24px; font-weight: 700; color: #4f46e5; margin: 0;">MeetTask AI</h1>
    </div>

    <!-- Main Card -->
    <div style="background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      <!-- Card Header -->
      <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px; color: white;">
        <h2 style="margin: 0 0 8px 0; font-size: 20px;">New Tasks Assigned</h2>
        <p style="margin: 0; opacity: 0.9; font-size: 14px;">From meeting: ${meetingTitle}</p>
      </div>

      <!-- Greeting -->
      <div style="padding: 24px 24px 16px 24px;">
        <p style="margin: 0; color: #475569;">
          Hi ${assigneeName},<br><br>
          ${creatorName} has assigned you ${tasks.length} task${tasks.length > 1 ? 's' : ''} from a recent meeting.
        </p>
      </div>

      <!-- Tasks Table -->
      <table style="width: 100%; border-collapse: collapse;">
        ${taskRows}
      </table>

      <!-- CTA Button -->
      <div style="padding: 24px; text-align: center;">
        <a href="${dashboardUrl}" 
           style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
          View Tasks in Dashboard
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px; color: #94a3b8; font-size: 12px;">
      <p style="margin: 0;">This email was sent by MeetTask AI</p>
      <p style="margin: 8px 0 0 0;">You received this because you were assigned a task.</p>
    </div>
  </div>
</body>
</html>
  `;
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  console.log('\n========================================');
  console.log('📧 [Notifications] Sending task emails');
  console.log('========================================\n');

  try {
    // Check if Resend is configured
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.log('⚠️ RESEND_API_KEY not configured - skipping email notifications');
      return response.status(200).json({ 
        success: true, 
        message: 'Email notifications skipped (RESEND_API_KEY not configured)',
        emailsSent: 0
      });
    }

    const resend = new Resend(resendApiKey);

    // Parse request
    const { meetingId, meetingTitle, tasks, creatorName }: NotificationRequest = request.body;

    if (!meetingId || !tasks || tasks.length === 0) {
      return response.status(400).json({ error: 'Missing meetingId or tasks' });
    }

    console.log('📋 Meeting:', meetingTitle);
    console.log('📋 Tasks to notify:', tasks.length);

    // Group tasks by assignee email to avoid sending multiple emails
    const tasksByAssignee = new Map<string, TaskForEmail[]>();
    
    for (const task of tasks) {
      if (!task.assignedToEmail) continue;
      
      const existing = tasksByAssignee.get(task.assignedToEmail) || [];
      existing.push(task);
      tasksByAssignee.set(task.assignedToEmail, existing);
    }

    console.log('👥 Unique assignees:', tasksByAssignee.size);

    // Dashboard URL (use environment variable or default)
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.BASE_URL || 'https://meettask.ai';
    const dashboardUrl = `${baseUrl}/tasks`;

    const db = getAdminDb();
    const emailResults: { email: string; success: boolean; error?: string }[] = [];

    // Send emails to each assignee
    for (const [email, assigneeTasks] of tasksByAssignee) {
      const assigneeName = assigneeTasks[0]?.assignedToName || email.split('@')[0];
      
      try {
        console.log(`📧 Sending email to ${email} (${assigneeTasks.length} tasks)...`);
        
        const { data, error } = await resend.emails.send({
          from: 'MeetTask AI <notifications@meettask.ai>',
          to: email,
          subject: `${assigneeTasks.length} New Task${assigneeTasks.length > 1 ? 's' : ''} from "${meetingTitle}"`,
          html: generateTaskEmailHtml(
            assigneeName,
            assigneeTasks,
            meetingTitle,
            creatorName || 'Your team',
            dashboardUrl
          ),
        });

        if (error) {
          console.error(`❌ Failed to send to ${email}:`, error);
          emailResults.push({ email, success: false, error: error.message });
        } else {
          console.log(`✅ Email sent to ${email}, ID: ${data?.id}`);
          emailResults.push({ email, success: true });

          // Update tasks to mark email sent
          for (const task of assigneeTasks) {
            await db.collection('tasks').doc(task.id).update({
              emailSent: true,
              emailSentAt: FieldValue.serverTimestamp(),
            });
          }
        }
      } catch (err: any) {
        console.error(`❌ Error sending to ${email}:`, err.message);
        emailResults.push({ email, success: false, error: err.message });
      }
    }

    const successCount = emailResults.filter(r => r.success).length;
    console.log(`\n✅ Emails sent: ${successCount}/${tasksByAssignee.size}`);

    return response.status(200).json({
      success: true,
      emailsSent: successCount,
      totalAssignees: tasksByAssignee.size,
      results: emailResults,
    });

  } catch (error: any) {
    console.error('❌ Notification error:', error.message);
    return response.status(500).json({ error: error.message });
  }
}
