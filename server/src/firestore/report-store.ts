/**
 * FirestoreReportStore (durable-server-stores D3; specs/content-reports, specs/device-records).
 *
 * One document per report in the `reports` collection, keyed by the server-generated report id.
 * A document carries the row's other seven fields; an optional text the user did not send is stored
 * as `''`, exactly as the SQLite store keeps it. Every query is on one field (`receivedAt` or
 * `deviceId`), so Firestore's automatic single-field indexes serve them all.
 */
import { randomUUID } from 'node:crypto';
import type { CollectionReference, DocumentSnapshot, Firestore, Query } from '@google-cloud/firestore';
import { deleteInBatches, type FirestoreRoot } from './client';
import {
  toListItem,
  type InsertReportParams,
  type ListReportsParams,
  type ReportListItem,
  type ReportRecordKeeping,
  type ReportRow,
  type ReportStore,
} from '../reports/store';

export const REPORTS_COLLECTION = 'reports';

const DAY_MS = 86_400_000;

/** The fields of one report document; the report id is the document id. */
type ReportDoc = Omit<ReportRow, 'reportId'>;

function fromSnapshot(snapshot: DocumentSnapshot): ReportRow {
  const doc = snapshot.data() as ReportDoc;
  return {
    reportId: snapshot.id,
    receivedAt: doc.receivedAt,
    deviceId: doc.deviceId,
    reason: doc.reason,
    note: doc.note,
    appName: doc.appName,
    prompt: doc.prompt,
    source: doc.source,
  };
}

export class FirestoreReportStore implements ReportStore, ReportRecordKeeping {
  constructor(
    private readonly db: Firestore,
    private readonly root: FirestoreRoot = db,
  ) {}

  private collection(): CollectionReference {
    return this.root.collection(REPORTS_COLLECTION);
  }

  async insert(params: InsertReportParams): Promise<string> {
    const reportId = randomUUID();
    const doc: ReportDoc = {
      receivedAt: params.now,
      deviceId: params.deviceId,
      reason: params.reason,
      note: params.note ?? '',
      appName: params.appName ?? '',
      prompt: params.prompt ?? '',
      source: params.source ?? '',
    };
    await this.collection().doc(reportId).create(doc);
    return reportId;
  }

  async list(params: ListReportsParams): Promise<ReportListItem[]> {
    let query: Query = this.collection();
    if (params.sinceDays !== undefined) query = query.where('receivedAt', '>=', params.now - params.sinceDays * DAY_MS);
    const snapshot = await query.orderBy('receivedAt', 'desc').limit(params.limit ?? 50).get();
    return snapshot.docs.map((doc) => toListItem(fromSnapshot(doc)));
  }

  async get(reportId: string): Promise<ReportRow | undefined> {
    const snapshot = await this.collection().doc(reportId).get();
    return snapshot.exists ? fromSnapshot(snapshot) : undefined;
  }

  async purgeOlderThan(cutoffMs: number): Promise<number> {
    return deleteInBatches(this.db, this.collection().where('receivedAt', '<', cutoffMs));
  }

  async listByDevice(deviceId: string): Promise<ReportRow[]> {
    const snapshot = await this.collection().where('deviceId', '==', deviceId).get();
    return snapshot.docs.map(fromSnapshot).sort((a, b) => a.receivedAt - b.receivedAt || a.reportId.localeCompare(b.reportId));
  }

  async deleteByDevice(deviceId: string): Promise<number> {
    return deleteInBatches(this.db, this.collection().where('deviceId', '==', deviceId));
  }

  /** The client belongs to whoever opened it (`OpenedStores.close` terminates it). */
  async close(): Promise<void> {}
}
