import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false, // MailHog uses port 1025 without TLS
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const url = `${env.APP_URL}/auth/verify-email?token=${token}`;
    logger.info({ to, url }, 'Sending verification email');

    await this.transporter.sendMail({
      from: '"Enterprise Task Manager" <noreply@taskmanager.local>',
      to,
      subject: 'Verify your email address',
      text: `Welcome! Please verify your email by clicking: ${url}`,
      html: `<p>Welcome!</p><p>Please verify your email by clicking <a href="${url}">here</a>.</p>`,
    });
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const url = `${env.APP_URL}/auth/reset-password?token=${token}`;
    logger.info({ to, url }, 'Sending password reset email');

    await this.transporter.sendMail({
      from: '"Enterprise Task Manager" <security@taskmanager.local>',
      to,
      subject: 'Reset your password',
      text: `You requested a password reset. Reset your password by clicking: ${url}`,
      html: `<p>You requested a password reset.</p><p>Reset your password by clicking <a href="${url}">here</a>.</p>`,
    });
  }

  async sendInvitationEmail(to: string, workspaceName: string, token: string): Promise<void> {
    const url = `${env.APP_URL}/invitations/accept?token=${token}`;
    logger.info({ to, workspaceName, url }, 'Sending workspace invitation email');

    await this.transporter.sendMail({
      from: '"Enterprise Task Manager" <invites@taskmanager.local>',
      to,
      subject: `You've been invited to join ${workspaceName}`,
      text: `You were invited to join ${workspaceName} on Enterprise Task Manager. Accept invitation: ${url}`,
      html: `<p>You were invited to join <strong>${workspaceName}</strong>.</p><p>Accept invitation by clicking <a href="${url}">here</a>.</p>`,
    });
  }

  async sendAssignmentEmail(
    to: string,
    taskTitle: string,
    actorName: string,
    taskId: string,
  ): Promise<void> {
    const url = `${env.APP_URL}/tasks/${taskId}`;
    logger.info({ to, taskTitle, actorName, taskId }, 'Sending task assignment email');

    await this.transporter.sendMail({
      from: '"Enterprise Task Manager" <notifications@taskmanager.local>',
      to,
      subject: `Assigned: ${taskTitle}`,
      text: `${actorName} assigned you to the task "${taskTitle}". View task: ${url}`,
      html: `<p>${actorName} assigned you to the task <strong>${taskTitle}</strong>.</p><p><a href="${url}">View Task</a></p>`,
    });
  }

  async sendDueReminderDigest(
    to: string,
    tasks: Array<{ title: string; dueDate: string; priority: string }>,
  ): Promise<void> {
    logger.info({ to, count: tasks.length }, 'Sending daily due reminder digest email');
    const taskListText = tasks
      .map((t) => `- ${t.title} (Priority: ${t.priority}, Due: ${t.dueDate})`)
      .join('\n');
    const taskListHtml = tasks
      .map(
        (t) =>
          `<li><strong>${t.title}</strong> &mdash; Priority: ${t.priority}, Due: ${new Date(t.dueDate).toLocaleDateString()}</li>`,
      )
      .join('');

    await this.transporter.sendMail({
      from: '"Enterprise Task Manager" <reminders@taskmanager.local>',
      to,
      subject: `Daily Task Reminder: ${tasks.length} task(s) due soon`,
      text: `Here are your tasks due in the next 24 hours:\n\n${taskListText}`,
      html: `<p>Here are your tasks due in the next 24 hours:</p><ul>${taskListHtml}</ul>`,
    });
  }
}

export const emailService = new EmailService();
