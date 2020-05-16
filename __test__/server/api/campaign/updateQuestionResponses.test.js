/**
 * @jest-environment jsdom
 */
import {
  cleanupTest,
  createScript,
  createStartedCampaign,
  runGql,
  sendMessage,
  setupTest
} from "../../../test_helpers";

const UpdateQuestionResponses = require("../../../../src/server/api/mutations/updateQuestionResponses");

import { r, loaders, cacheableData } from "../../../../src/server/models";
const errors = require("../../../../src/server/api/errors");

import React from "react";
import { mount } from "enzyme";
import MuiThemeProvider from "material-ui/styles/MuiThemeProvider";
import { StyleSheetTestUtils } from "aphrodite";
import {
  AssignmentTexterContact,
  mapMutationsToProps
} from "../../../../src/containers/AssignmentTexterContact";
import { AssignmentTexterContactControls } from "../../../../src/components/AssignmentTexter/Controls";
import {
  dataQueryString as assignmentQueryString,
  contactDataFragment
} from "../../../../src/containers/TexterTodo";

describe("mutations.updateQuestionResponses", () => {
  let adminUser;
  let campaign;
  let texterUser;
  let contacts;
  let assignment;
  let interactionSteps;
  let returnedInteractionSteps;
  let colorInteractionSteps;
  let redInteractionStep;
  let shadesOfRedInteractionSteps;
  let questionResponses;
  let questionResponseValuesDatabaseSql;
  let organization;

  beforeEach(async () => {
    await setupTest();
    jest.restoreAllMocks();
  }, global.DATABASE_SETUP_TEARDOWN_TIMEOUT);

  afterEach(async () => {
    await cleanupTest();
    if (r.redis) r.redis.flushdb();
  }, global.DATABASE_SETUP_TEARDOWN_TIMEOUT);

  beforeEach(async () => {
    // use this to ensure we're calling updateQuestionResponses as expected
    jest.spyOn(UpdateQuestionResponses, "updateQuestionResponses");

    questionResponseValuesDatabaseSql = `
      SELECT
        child.answer_option,
        child.id as child_id,
        child.parent_interaction_id,
        interaction_step.campaign_id,
        interaction_step.question,
        interaction_step.script,
        child.answer_actions,
        question_response.value
      FROM
        question_response
      JOIN
        interaction_step ON interaction_step.id = question_response.interaction_step_id
      JOIN
        interaction_step as child ON child.parent_interaction_id = interaction_step.id and question_response.value = child.answer_option
      WHERE
        question_response.campaign_contact_id = ?
      ORDER BY
        question_response.id;
      `;

    const startedCampaign = await createStartedCampaign();

    ({
      testOrganization: {
        data: { createOrganization: organization }
      },
      testAdminUser: adminUser,
      testCampaign: campaign,
      testTexterUser: texterUser,
      testContacts: contacts,
      assignment
    } = startedCampaign);

    interactionSteps = [
      {
        id: "new_1",
        questionText: "What is your favorite color",
        script: "Hello {firstName}. Let's talk about your favorite color.",
        answerOption: "",
        answerActions: "",
        answerActionsData: "",
        parentInteractionId: null,
        isDeleted: false,
        interactionSteps: [
          {
            id: "new_2",
            questionText: "What is your favorite shade of red?",
            script: "Red is an awesome color, {firstName}!",
            answerOption: "Red",
            answerActions: "",
            answerActionsData: "",
            parentInteractionId: "new_1",
            isDeleted: false,
            interactionSteps: [
              {
                id: "new_21",
                questionText: "",
                script: "Crimson is a rad shade of red, {firstName}",
                answerOption: "Crimson",
                answerActions: "",
                answerActionsData: "",
                parentInteractionId: "new_2",
                isDeleted: false,
                interactionSteps: []
              },
              {
                id: "new_22",
                questionText: "",
                script: "Firebrick is a rad shade of red, {firstName}",
                answerOption: "Firebrick",
                answerActions: "",
                answerActionsData: "",
                parentInteractionId: "new_2",
                isDeleted: false,
                interactionSteps: []
              }
            ]
          },
          {
            id: "new_3",
            questionText: "",
            script: "Purple is an awesome color, {firstName}!",
            answerOption: "Purple",
            answerActions: "",
            answerActionsData: "",
            parentInteractionId: "new_1",
            isDeleted: false,
            interactionSteps: []
          }
        ]
      }
    ];

    returnedInteractionSteps = (
      await createScript(adminUser, campaign, {
        interactionSteps: interactionSteps[0],
        campaignGqlFragment: `
        interactionSteps {
          id
          questionText
          script
          answerOption
          answerActions
          answerActionsData
          parentInteractionId
          isDeleted
        }
      `
      })
    ).data.editCampaign.interactionSteps;

    // we've created a script with this outline:
    // What's your favorite color?
    // Answer: Red
    //   What's your favorite shade of red?
    //     Answer: firebrick
    //     Answer: crimson
    // Answer: Purple

    // these are the answers to the question "what's your favorite color?"
    colorInteractionSteps = returnedInteractionSteps.filter(
      interactionStep =>
        interactionStep.parentInteractionId === returnedInteractionSteps[0].id
    );

    // this is the interaction step representing the answer "Red"
    redInteractionStep = colorInteractionSteps.find(
      colorInteractionStep => colorInteractionStep.answerOption === "Red"
    );

    // these are the answers to the question "what's your favorite shade of red"
    shadesOfRedInteractionSteps = returnedInteractionSteps.filter(
      interactionStep =>
        interactionStep.parentInteractionId === redInteractionStep.id
    );

    // send initial messages to 2 contacts
    const promises = contacts.slice(0, 2).map(contact => {
      return sendMessage(contact.id, texterUser, {
        text: returnedInteractionSteps[0].script,
        contactNumber: contact.cell,
        assignmentId: assignment.id,
        userId: texterUser.id.toString()
      });
    });

    await Promise.all(promises);

    questionResponses = [
      {
        campaignContactId: contacts[0].id,
        interactionStepId: returnedInteractionSteps[0].id,
        value: colorInteractionSteps[0].answerOption
      },
      {
        campaignContactId: contacts[0].id.toString(),
        interactionStepId: redInteractionStep.id,
        value: shadesOfRedInteractionSteps[0].answerOption
      }
    ];
  });

  it("called through the mutation, it records answers for a contact", async () => {
    // verify that contacts have messageStatus === 'messaged'
    const results = await r
      .knex("campaign_contact")
      .select("message_status")
      .whereIn(
        "id",
        contacts.slice(0, 2).map(contact => contact.id)
      );

    expect(results).toEqual([
      {
        message_status: "messaged"
      },
      {
        message_status: "messaged"
      }
    ]);

    const updateQuestionResponseGql = `
      mutation updateQuestionResponses($qr: [QuestionResponseInput], $ccid: String!) {
        updateQuestionResponses(questionResponses: $qr, campaignContactId: $ccid) {
          id
          messageStatus
          questionResponseValues {
            interactionStepId
            value
          }
        }
      }
    `;

    const variables = {
      ccid: contacts[0].id,
      qr: questionResponses
    };

    // this returns immediately before doing any updates
    const updateQuestionResponseResult = await runGql(
      updateQuestionResponseGql,
      variables,
      texterUser
    );

    // verify that updateQuestionResponses was called as expected
    expect(UpdateQuestionResponses.updateQuestionResponses.mock.calls).toEqual([
      [
        [
          {
            campaignContactId: contacts[0].id.toString(),
            interactionStepId: returnedInteractionSteps[0].id.toString(),
            value: "Red"
          },
          {
            campaignContactId: contacts[0].id.toString(),
            interactionStepId: "2",
            value: "Crimson"
          }
        ],
        contacts[0].id.toString(),
        loaders,
        texterUser
      ]
    ]);

    // verify that updateQuestionResponses returns what we expect
    expect(updateQuestionResponseResult.data.updateQuestionResponses).toEqual({
      id: contacts[0].id.toString(),
      messageStatus: "messaged",
      questionResponseValues: [
        {
          interactionStepId: 1,
          value: "Red"
        },
        {
          interactionStepId: 2,
          value: "Crimson"
        }
      ]
    });

    const databaseQueryResults = await r.knex.raw(
      questionResponseValuesDatabaseSql,
      [contacts[0].id]
    );

    // verify that updateQuestionResponses really updated the question_responses

    // databaseQueryResults.rows will be truthy if we're using postgres
    // and short circuit, otherwise for sqlite databaseQueryResults will
    // contain the rows
    expect(databaseQueryResults.rows || databaseQueryResults).toEqual([
      {
        answer_option: "Red",
        child_id: Number(colorInteractionSteps[0].id),
        parent_interaction_id: Number(returnedInteractionSteps[0].id),
        campaign_id: Number(campaign.id),
        question: "What is your favorite color",
        script: "Hello {firstName}. Let's talk about your favorite color.",
        answer_actions: "",
        value: "Red"
      },
      {
        answer_option: "Crimson",
        child_id: Number(shadesOfRedInteractionSteps[0].id),
        parent_interaction_id: Number(colorInteractionSteps[0].id),
        campaign_id: Number(campaign.id),
        question: "What is your favorite shade of red?",
        script: "Red is an awesome color, {firstName}!",
        answer_actions: "",
        value: "Crimson"
      }
    ]);
  });

  describe("called through the UI, it updates answers for a contact", () => {
    let updatedCampaign;
    let updatedContacts;
    let updatedAssignment;

    beforeEach(async () => {
      const variables = {
        contactsFilter: {
          messageStatus: "messaged"
        },
        assignmentId: assignment.id.toString()
      };

      const retrievedAssignment = await runGql(
        assignmentQueryString,
        variables,
        adminUser
      );

      ({
        data: { assignment: updatedAssignment }
      } = retrievedAssignment);

      updatedCampaign = updatedAssignment.campaign;

      const getAssignmentContactsGql = `
        mutation getAssignmentContacts($assignmentId: String!, $contactIds: [String]!, $findNew: Boolean) {
          getAssignmentContacts(assignmentId: $assignmentId, contactIds: $contactIds, findNew: $findNew) {
            ${contactDataFragment}
          }
        }
      `;

      const getAssignmentVariables = {
        assignmentId: assignment.id,
        contactIds: contacts[0].id,
        findNew: false
      };

      const retrievedContacts = await runGql(
        getAssignmentContactsGql,
        getAssignmentVariables,
        adminUser
      );

      ({
        data: { getAssignmentContacts: updatedContacts }
      } = retrievedContacts);
    });

    it("causes the database to be updated correctly", async () => {
      const navigationToolbarChildren = {
        onNext: jest.fn(),
        onPrevious: jest.fn(),
        title: "1 of 2",
        total: 2,
        currentIndex: 1
      };
      StyleSheetTestUtils.suppressStyleInjection();

      const mutations = mapMutationsToProps();

      const makeRunnableMutations = (mutationsToWrap, user) => {
        const newMutations = {};

        Object.keys(mutationsToWrap).forEach(k => {
          newMutations[k] = async (...args) => {
            // TODO validate received args against args in the schema
            const toWrap = mutationsToWrap[k](...args);
            return runGql(
              toWrap.mutation.loc.source.body,
              toWrap.variables,
              user
            );
          };
        });
        return newMutations;
      };

      const wrappedMutations = makeRunnableMutations(mutations, texterUser);

      const component = await mount(
        <MuiThemeProvider>
          <AssignmentTexterContact
            mutations={wrappedMutations}
            find-me="here"
            texter={{ ...texterUser }}
            campaign={{ ...updatedCampaign }}
            assignment={{ ...updatedAssignment }}
            refreshData={jest.fn()}
            contact={{ ...updatedContacts[0] }}
            navigationToolbarChildren={navigationToolbarChildren}
          />
        </MuiThemeProvider>
      );

      const assignmentTexterContactWrapper = component.find(
        AssignmentTexterContact
      );

      const assignmentTexterContact = assignmentTexterContactWrapper.instance();

      const controlsWrapper = assignmentTexterContactWrapper.find(
        AssignmentTexterContactControls
      );

      const controls = controlsWrapper.instance();

      controls.handleQuestionResponseChange({
        interactionStep: returnedInteractionSteps[0],
        questionResponseValue: "Red"
      });

      await assignmentTexterContact.handleSubmitSurveys();

      const databaseQueryResults = await r.knex.raw(
        questionResponseValuesDatabaseSql,
        [updatedContacts[0].id]
      );

      expect(databaseQueryResults.rows || databaseQueryResults).toEqual([
        {
          answer_actions: "",
          answer_option: "Red",
          campaign_id: 1,
          child_id: 2,
          parent_interaction_id: 1,
          question: "What is your favorite color",
          script: "Hello {firstName}. Let's talk about your favorite color.",
          value: "Red"
        }
      ]);
    });
  });

  describe("#updateQuestionResponses", () => {
    beforeEach(async () => {
      jest.spyOn(loaders.campaignContact, "load");
      jest.spyOn(loaders.campaign, "load");
      jest.spyOn(errors, "assignmentRequiredOrAdminRole");
      jest.spyOn(cacheableData.questionResponse, "save");
    });
    it("delegates to its dependencies", async () => {
      await UpdateQuestionResponses.updateQuestionResponses(
        questionResponses,
        contacts[0].id,
        loaders,
        texterUser
      );
      expect(loaders.campaignContact.load.mock.calls).toEqual([[1], [1]]);
      expect(loaders.campaign.load.mock.calls).toEqual([[contacts[0].id]]);
      expect(errors.assignmentRequiredOrAdminRole.mock.calls).toEqual([
        [
          texterUser,
          Number(organization.id),
          Number(assignment.id),
          expect.objectContaining({ id: contacts[0].id })
        ]
      ]);
      expect(cacheableData.questionResponse.save.mock.calls).toEqual([
        [1, questionResponses]
      ]);
    });
  });
});