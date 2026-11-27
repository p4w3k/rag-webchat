import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { StoredMessage } from "@rag-webchat/shared";

const RETENTION_DAYS = 30;

/**
 * Single-table layout:
 *   pk SESSION#<id>  sk MSG#<iso time>#<id>   chat messages
 *   pk SESSION#<id>  sk RATE#<yyyy-mm-dd>     messages sent by the session that day
 *   pk IP#<ip>       sk RATE#<yyyy-mm-ddThh>  requests from an IP that hour
 * Every item has `expiresAt` (epoch seconds) for DynamoDB TTL.
 */
export class ChatStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async loadHistory(sessionId: string, limit: number): Promise<StoredMessage[]> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :msg)",
        ExpressionAttributeValues: { ":pk": `SESSION#${sessionId}`, ":msg": "MSG#" },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? [])
      .map((item) => StoredMessage.safeParse(item))
      .flatMap((r) => (r.success ? [r.data] : []))
      .reverse();
  }

  async saveMessages(messages: StoredMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: messages.map((m) => ({
            PutRequest: {
              Item: { pk: `SESSION#${m.sessionId}`, sk: `MSG#${m.createdAt}#${m.messageId}`, ...m, expiresAt: expiry(RETENTION_DAYS) },
            },
          })),
        },
      }),
    );
  }

  /** Increments the counter and returns the new value. */
  async increment(pk: string, sk: string, ttlDays: number): Promise<number> {
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: "ADD #count :one SET expiresAt = if_not_exists(expiresAt, :exp)",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":one": 1, ":exp": expiry(ttlDays) },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(res.Attributes?.count ?? 0);
  }
}

function expiry(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}
