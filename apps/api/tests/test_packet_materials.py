from orbit_api.job_portal.resume_lineage import PacketMaterials, digest, packet_materials


def test_materials_survive_nested_packet_edits() -> None:
    answers = [{"value": {"text": "Three years"}}]
    fields = {"location": {"city": "Delhi"}}
    captured = packet_materials(answers, fields, "Approved cover letter")
    answers[0]["value"]["text"] = "Changed later"
    fields["location"]["city"] = "Changed later"
    parsed = PacketMaterials.model_validate(captured)
    assert parsed.answers[0]["value"]["text"] == "Three years"
    assert parsed.fields["location"]["city"] == "Delhi"
    assert parsed.content_digest == digest(parsed.model_dump(exclude={"content_digest"}))
