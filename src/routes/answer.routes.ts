// src/routes/v1/auth.routes.ts
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { JWTPayload } from '../interfaces/jwt';
import { getEnvVariable } from '../common/src/utils/config';
import AnswerModel from '../common/src/mongoose-schemas/v1/answer.schema';

const SESSION = 'session';
const QUESTION_COLLECTION = 'question-collection';
const QUESTION = 'question';
const ANSWER = 'answer';

var amqp = require('amqplib/callback_api');

const RABBITMQ_USERNAME = getEnvVariable('RABBITMQ_USERNAME') || 'rabbitmq_user';
const RABBITMQ_PASSWORD = getEnvVariable('RABBITMQ_PASSWORD') || 'rabbitmq_password';
const RABBITMQ_HOSTNAME = getEnvVariable('RABBITMQ_HOSTNAME') || 'rabbitmq_host';
const RABBITMQ_PORT = getEnvVariable('RABBITMQ_PORT') || 'rabbitmq_port';
const RABBITMQ_QUEUE = getEnvVariable('RABBITMQ_QUEUE') || 'rabbitmq_queue';
const RABBITMQ_QUEUE_NAME = getEnvVariable('RABBITMQ_QUEUE_NAME') || 'rabbitmq_queue_name';

const RABBITMQ_URI = `amqp://${RABBITMQ_USERNAME}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOSTNAME}:${RABBITMQ_PORT}/${RABBITMQ_QUEUE}`;

interface AnswerData {
  content: {
    type: string;
    value: string | number | boolean;
  };
}

export default function answerRoutes(fastify: FastifyInstance, options: FastifyPluginOptions, done: () => void) {
  let channel: any = null;

  console.log(`Connecting to RabbitMQ at ${RABBITMQ_URI}`);
  amqp.connect(RABBITMQ_URI, function (error0: any, connection: any) {
    if (error0) {
      throw error0;
    }
    connection.createChannel(function (error1: any, ch: any) {
      if (error1) {
        throw error1;
      }
      channel = ch;
      channel.assertQueue(RABBITMQ_QUEUE_NAME, { durable: false });
    });
  });

  fastify.post(
    `/${SESSION}/:sid/${QUESTION_COLLECTION}/:qcid/${QUESTION}/:qid/${ANSWER}`,
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const answerData: AnswerData = request.body as AnswerData;
        const { sid, qcid, qid } = request.params as { sid: string; qcid: string; qid: string };
        const ownerId: string = (request.user as JWTPayload).userIdentifier;
        const createdAnswer = await AnswerModel.create({
          ownerId: ownerId,
          sessionId: sid,
          questionId: qid,
          content: answerData.content,
        });

        const msg = JSON.stringify({ content: createdAnswer.content, aid: createdAnswer._id, sessionId: sid });

        channel.assertQueue(RABBITMQ_QUEUE_NAME, { durable: false });
        console.log('Sent to queue:', msg);
        channel.sendToQueue(RABBITMQ_QUEUE_NAME, Buffer.from(msg));
        console.log('Using queue:', sid);

        return reply.code(201).send(createdAnswer);
      } catch (error) {
        console.error('Error creating answer:', error);
        return reply.code(500).send('Internal Server Error');
      }
    }
  );

  fastify.patch(
    `/${SESSION}/:sid/${QUESTION_COLLECTION}/:qcid/${QUESTION}/:qid/${ANSWER}/:aid`,
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      console.log('patch');
      try {
        const answerData = request.body as AnswerData;
        const { aid, sid } = request.params as { aid: string; sid: string };
        const ownerId: string = (request.user as JWTPayload).userIdentifier;

        const updatedAnswer = await AnswerModel.findOneAndUpdate(
          { ownerId, _id: aid },
          { $set: { content: answerData.content } },
          { new: true }
        );

        if (!updatedAnswer) {
          return reply.code(404).send('Answer not found');
        }

        const msg = JSON.stringify({ content: updatedAnswer.content, aid, sessionId: sid });

        channel.assertQueue(RABBITMQ_QUEUE_NAME, { durable: false });
        console.log('Sent to queue:', msg);
        channel.sendToQueue(RABBITMQ_QUEUE_NAME, Buffer.from(msg));
        console.log('Using queue:', sid);

        return reply.code(200).send({ message: 'updatedAnswer' });
      } catch (error) {
        console.error('Error updating answer:', error);
        return reply.code(500).send('Internal Server Error');
      }
    }
  );

  done();
}
